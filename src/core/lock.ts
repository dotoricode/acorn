import {
  readFileSync,
  writeFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
  renameSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHarnessRoot } from './env.ts';
import { stripBom } from './bom.ts';

// ── v2 constants & types ────────────────────────────────────────────────────

export const SCHEMA_VERSION = 2 as const;
export const TOOL_NAMES = ['omc', 'gstack', 'ecc'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const OPTIONAL_TOOL_NAMES = ['superpowers', 'claude-mem'] as const;
export type OptionalToolName = (typeof OPTIONAL_TOOL_NAMES)[number];

export const GUARD_MODES = ['block', 'warn', 'log'] as const;
export type GuardMode = (typeof GUARD_MODES)[number];

export const GUARD_PATTERNS = ['strict', 'moderate', 'minimal'] as const;
export type GuardPatterns = (typeof GUARD_PATTERNS)[number];

/**
 * §15 HIGH-2 / ADR-020 (v0.4.0): `harness.lock.tools.<name>.repo` allowlist.
 * 악성 lock 이 공격자 저장소를 지정하지 못하도록 acorn 이 아는 저장소만 허용.
 * Escape hatch: `ACORN_ALLOW_ANY_REPO=1` (fork / 내부 미러 / 로컬 dev).
 */
export const ALLOWED_REPOS: Readonly<Record<ToolName, readonly string[]>> = {
  omc: ['Yeachan-Heo/oh-my-claudecode'],
  gstack: ['garrytan/gstack'],
  ecc: ['affaan-m/everything-claude-code'],
};

export interface ToolEntry {
  readonly repo: string;
  readonly commit: string;
  readonly verified_at: string;
}

export interface GuardConfig {
  readonly mode: GuardMode;
  readonly patterns: GuardPatterns;
}

export interface HarnessLock {
  readonly schema_version: 2;
  readonly acorn_version: string;
  readonly tools: Readonly<Record<ToolName, ToolEntry>>;
  readonly optional_tools: Readonly<Partial<Record<OptionalToolName, ToolEntry>>>;
  readonly guard: GuardConfig;
}

// ── v3 constants & types ────────────────────────────────────────────────────

export const CAPABILITY_NAMES = [
  'planning',
  'spec',
  'tdd',
  'review',
  'qa_ui',
  'qa_headless',
  'hooks',
  'memory',
] as const;
export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

export interface CapabilityConfig {
  readonly providers: readonly string[];
}

export type ProviderInstallStrategy = 'git-clone' | 'npm' | 'npx' | 'plugin-marketplace';

export type ProviderEntry =
  | {
      readonly install_strategy: 'git-clone';
      readonly repo: string;
      readonly commit: string;
      readonly verified_at: string;
    }
  | {
      readonly install_strategy: 'npm' | 'npx';
      readonly install_cmd: string;
      readonly verified_at: string;
    }
  | {
      // v0.9.2+: Claude Code plugin marketplace.
      // acorn 자체는 설치 실행을 못하므로 사용자에게 `claude /plugin install <pkg>@<marketplace>`
      // 안내 출력만 하고 verify 는 detect 모듈에 위임.
      readonly install_strategy: 'plugin-marketplace';
      readonly marketplace: string; // e.g. "obra/superpowers-marketplace"
      readonly plugin: string;       // e.g. "superpowers"
      readonly verified_at: string;
    };

export interface PresetEntry {
  readonly capabilities: readonly CapabilityName[];
}

export interface HarnessLockV3 {
  readonly schema_version: 3;
  readonly acorn_version: string;
  readonly capabilities: Readonly<Partial<Record<CapabilityName, CapabilityConfig>>>;
  readonly providers: Readonly<Record<string, ProviderEntry>>;
  readonly presets?: Readonly<Record<string, PresetEntry>>;
  readonly guard: GuardConfig;
}

export type AnyHarnessLock = HarnessLock | HarnessLockV3;

// ── error types ─────────────────────────────────────────────────────────────

export type LockErrorCode = 'NOT_FOUND' | 'PARSE' | 'SCHEMA' | 'IO';

export class LockError extends Error {
  readonly code: LockErrorCode;
  constructor(message: string, code: LockErrorCode) {
    super(message);
    this.name = 'LockError';
    this.code = code;
  }
}

export function defaultLockPath(harnessRoot?: string): string {
  return join(harnessRoot ?? defaultHarnessRoot(), 'harness.lock');
}

// ── shared regexes ───────────────────────────────────────────────────────────

const SHA1_RE = /^[a-f0-9]{40}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ── shared JSON parser ───────────────────────────────────────────────────────

function parseRawJson(raw: string): Record<string, unknown> {
  const stripped = stripBom(raw);
  let data: unknown;
  try {
    data = JSON.parse(stripped);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new LockError(`JSON 파싱 실패: ${msg}`, 'PARSE');
  }
  if (!isObject(data)) {
    throw new LockError('루트가 object 가 아닙니다', 'SCHEMA');
  }
  if (!('schema_version' in data)) {
    throw new LockError('schema_version 필드 누락', 'SCHEMA');
  }
  return data;
}

// ── v2 validators ────────────────────────────────────────────────────────────

/**
 * §15 HIGH-2 / ADR-020 (v0.4.0): repo allowlist 검증.
 * `ACORN_ALLOW_ANY_REPO=1` 이면 검증 skip (escape hatch).
 */
function isRepoAllowed(tool: ToolName, repo: string): boolean {
  if (process.env['ACORN_ALLOW_ANY_REPO'] === '1') return true;
  return (ALLOWED_REPOS[tool] as readonly string[]).includes(repo);
}

function validateToolEntry(tool: ToolName, raw: unknown): ToolEntry {
  if (!isObject(raw)) {
    throw new LockError(`tools.${tool}: object 가 아닙니다`, 'SCHEMA');
  }
  const { repo, commit, verified_at } = raw;
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
    throw new LockError(`tools.${tool}.repo: "owner/name" 형식이어야 합니다`, 'SCHEMA');
  }
  // §15 HIGH-2 / ADR-020: allowlist 검증. 악성 lock 이 공격자 저장소를 지정하는
  // 공급망 공격 방어. Fork / 내부 미러 필요 시 ACORN_ALLOW_ANY_REPO=1 로 우회.
  if (!isRepoAllowed(tool, repo)) {
    const allowed = ALLOWED_REPOS[tool].join(', ');
    throw new LockError(
      `tools.${tool}.repo: "${repo}" 는 허용 목록에 없습니다. ` +
        `허용: [${allowed}]. ` +
        `fork/미러 사용 중이라면 ACORN_ALLOW_ANY_REPO=1 로 실행.`,
      'SCHEMA',
    );
  }
  if (typeof commit !== 'string' || !SHA1_RE.test(commit)) {
    throw new LockError(`tools.${tool}.commit: 40자 SHA1 이어야 합니다`, 'SCHEMA');
  }
  if (typeof verified_at !== 'string' || !ISO_DATE_RE.test(verified_at)) {
    throw new LockError(`tools.${tool}.verified_at: YYYY-MM-DD 이어야 합니다`, 'SCHEMA');
  }
  return { repo, commit, verified_at };
}

function validateGuard(raw: unknown): GuardConfig {
  if (!isObject(raw)) {
    throw new LockError('guard: object 가 아닙니다', 'SCHEMA');
  }
  const { mode, patterns } = raw;
  if (typeof mode !== 'string' || !(GUARD_MODES as readonly string[]).includes(mode)) {
    throw new LockError(
      `guard.mode: ${GUARD_MODES.join('|')} 중 하나여야 합니다`,
      'SCHEMA',
    );
  }
  if (
    typeof patterns !== 'string' ||
    !(GUARD_PATTERNS as readonly string[]).includes(patterns)
  ) {
    throw new LockError(
      `guard.patterns: ${GUARD_PATTERNS.join('|')} 중 하나여야 합니다`,
      'SCHEMA',
    );
  }
  return { mode: mode as GuardMode, patterns: patterns as GuardPatterns };
}

function validateOptionalToolEntry(tool: string, raw: unknown): ToolEntry {
  if (!isObject(raw)) {
    throw new LockError(`optional_tools.${tool}: object 가 아닙니다`, 'SCHEMA');
  }
  const { repo, commit, verified_at } = raw;
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
    throw new LockError(`optional_tools.${tool}.repo: "owner/name" 형식이어야 합니다`, 'SCHEMA');
  }
  if (typeof commit !== 'string' || !SHA1_RE.test(commit)) {
    throw new LockError(`optional_tools.${tool}.commit: 40자 SHA1 이어야 합니다`, 'SCHEMA');
  }
  if (typeof verified_at !== 'string' || !ISO_DATE_RE.test(verified_at)) {
    throw new LockError(`optional_tools.${tool}.verified_at: YYYY-MM-DD 이어야 합니다`, 'SCHEMA');
  }
  return { repo, commit, verified_at };
}

function validateOptionalTools(
  raw: Record<string, unknown>,
): Partial<Record<OptionalToolName, ToolEntry>> {
  const result: Partial<Record<OptionalToolName, ToolEntry>> = {};
  for (const key of Object.keys(raw)) {
    if (!(OPTIONAL_TOOL_NAMES as readonly string[]).includes(key)) {
      throw new LockError(
        `optional_tools.${key}: 알 수 없는 도구명. 허용: ${OPTIONAL_TOOL_NAMES.join(', ')}`,
        'SCHEMA',
      );
    }
    result[key as OptionalToolName] = validateOptionalToolEntry(key, raw[key]);
  }
  return result;
}

// ── v3 validators ────────────────────────────────────────────────────────────

function validateCapabilityName(name: string): CapabilityName {
  if (!(CAPABILITY_NAMES as readonly string[]).includes(name)) {
    throw new LockError(
      `capabilities: "${name}" 는 허용된 capability 이름이 아닙니다. ` +
        `허용: ${CAPABILITY_NAMES.join(', ')}`,
      'SCHEMA',
    );
  }
  return name as CapabilityName;
}

function validateCapabilityConfig(name: string, raw: unknown): CapabilityConfig {
  if (!isObject(raw)) {
    throw new LockError(`capabilities.${name}: object 가 아닙니다`, 'SCHEMA');
  }
  const { providers } = raw;
  if (
    !Array.isArray(providers) ||
    !providers.every((p): p is string => typeof p === 'string')
  ) {
    throw new LockError(`capabilities.${name}.providers: string[] 이어야 합니다`, 'SCHEMA');
  }
  return { providers: providers as readonly string[] };
}

function validateCapabilities(
  raw: unknown,
): Partial<Record<CapabilityName, CapabilityConfig>> {
  if (!isObject(raw)) {
    throw new LockError('capabilities: object 가 아닙니다', 'SCHEMA');
  }
  const result: Partial<Record<CapabilityName, CapabilityConfig>> = {};
  for (const key of Object.keys(raw)) {
    const capName = validateCapabilityName(key);
    result[capName] = validateCapabilityConfig(key, raw[key]);
  }
  return result;
}

function validateProviderEntry(name: string, raw: unknown): ProviderEntry {
  if (!isObject(raw)) {
    throw new LockError(`providers.${name}: object 가 아닙니다`, 'SCHEMA');
  }
  const { install_strategy, verified_at } = raw;
  const VALID_STRATEGIES: readonly string[] = ['git-clone', 'npm', 'npx', 'plugin-marketplace'];
  if (typeof install_strategy !== 'string' || !VALID_STRATEGIES.includes(install_strategy)) {
    throw new LockError(
      `providers.${name}.install_strategy: ${VALID_STRATEGIES.join('|')} 중 하나여야 합니다`,
      'SCHEMA',
    );
  }
  if (typeof verified_at !== 'string' || !ISO_DATE_RE.test(verified_at)) {
    throw new LockError(`providers.${name}.verified_at: YYYY-MM-DD 이어야 합니다`, 'SCHEMA');
  }
  if (install_strategy === 'git-clone') {
    const { repo, commit } = raw;
    if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
      throw new LockError(`providers.${name}.repo: "owner/name" 형식이어야 합니다`, 'SCHEMA');
    }
    if (typeof commit !== 'string' || !SHA1_RE.test(commit)) {
      throw new LockError(`providers.${name}.commit: 40자 SHA1 이어야 합니다`, 'SCHEMA');
    }
    return { install_strategy: 'git-clone', repo, commit, verified_at };
  }
  if (install_strategy === 'plugin-marketplace') {
    const { marketplace, plugin } = raw;
    if (typeof marketplace !== 'string' || !REPO_RE.test(marketplace)) {
      throw new LockError(
        `providers.${name}.marketplace: "owner/name" 형식이어야 합니다`,
        'SCHEMA',
      );
    }
    if (typeof plugin !== 'string' || plugin.length === 0) {
      throw new LockError(
        `providers.${name}.plugin: 비어있지 않은 문자열이어야 합니다`,
        'SCHEMA',
      );
    }
    return { install_strategy: 'plugin-marketplace', marketplace, plugin, verified_at };
  }
  const { install_cmd } = raw;
  if (typeof install_cmd !== 'string' || install_cmd.length === 0) {
    throw new LockError(
      `providers.${name}.install_cmd: npm/npx 전략에서 비어있지 않은 문자열이어야 합니다`,
      'SCHEMA',
    );
  }
  return { install_strategy: install_strategy as 'npm' | 'npx', install_cmd, verified_at };
}

function validateProviders(raw: unknown): Record<string, ProviderEntry> {
  if (!isObject(raw)) {
    throw new LockError('providers: object 가 아닙니다', 'SCHEMA');
  }
  const result: Record<string, ProviderEntry> = {};
  for (const name of Object.keys(raw)) {
    result[name] = validateProviderEntry(name, raw[name]);
  }
  return result;
}

function validatePresetEntry(name: string, raw: unknown): PresetEntry {
  if (!isObject(raw)) {
    throw new LockError(`presets.${name}: object 가 아닙니다`, 'SCHEMA');
  }
  const { capabilities } = raw;
  if (!Array.isArray(capabilities)) {
    throw new LockError(`presets.${name}.capabilities: array 이어야 합니다`, 'SCHEMA');
  }
  const validated: CapabilityName[] = [];
  for (const cap of capabilities) {
    if (typeof cap !== 'string') {
      throw new LockError(
        `presets.${name}.capabilities: 모든 항목이 string 이어야 합니다`,
        'SCHEMA',
      );
    }
    validated.push(validateCapabilityName(cap));
  }
  return { capabilities: validated };
}

function validatePresets(raw: unknown): Record<string, PresetEntry> {
  if (!isObject(raw)) {
    throw new LockError('presets: object 가 아닙니다', 'SCHEMA');
  }
  const result: Record<string, PresetEntry> = {};
  for (const name of Object.keys(raw)) {
    result[name] = validatePresetEntry(name, raw[name]);
  }
  return result;
}

// ── internal body parsers (take pre-parsed objects) ─────────────────────────

function parseLockV2Body(data: Record<string, unknown>): HarnessLock {
  const { acorn_version, tools, guard } = data;
  if (typeof acorn_version !== 'string' || acorn_version.length === 0) {
    throw new LockError('acorn_version: 비어있지 않은 문자열이어야 합니다', 'SCHEMA');
  }
  if (!isObject(tools)) {
    throw new LockError('tools: object 가 아닙니다', 'SCHEMA');
  }
  const validatedTools: Record<ToolName, ToolEntry> = {} as Record<ToolName, ToolEntry>;
  for (const name of TOOL_NAMES) {
    if (!(name in tools)) {
      throw new LockError(`tools.${name}: 누락`, 'SCHEMA');
    }
    validatedTools[name] = validateToolEntry(name, tools[name]);
  }
  const optional_tools = isObject(data.optional_tools)
    ? validateOptionalTools(data.optional_tools)
    : {};
  return {
    schema_version: SCHEMA_VERSION,
    acorn_version,
    tools: validatedTools,
    optional_tools,
    guard: validateGuard(guard),
  };
}

function parseLockV3Body(data: Record<string, unknown>): HarnessLockV3 {
  const { acorn_version, guard } = data;
  if (typeof acorn_version !== 'string' || acorn_version.length === 0) {
    throw new LockError('acorn_version: 비어있지 않은 문자열이어야 합니다', 'SCHEMA');
  }
  const capabilities = validateCapabilities(data['capabilities'] ?? {});
  const providers = validateProviders(data['providers'] ?? {});
  const presets = isObject(data['presets'])
    ? validatePresets(data['presets'])
    : undefined;
  const result: HarnessLockV3 = {
    schema_version: 3,
    acorn_version,
    capabilities,
    providers,
    guard: validateGuard(guard),
  };
  if (presets !== undefined) {
    return { ...result, presets };
  }
  return result;
}

// ── public parse API ─────────────────────────────────────────────────────────

/**
 * v1|v2 lock JSON 을 파싱해 HarnessLock 을 반환한다.
 * v1 입력은 in-memory v2 로 투명 마이그레이션된다.
 * v3 이상은 거부한다.
 */
export function parseLockV2(raw: string): HarnessLock {
  const data = parseRawJson(raw);
  const { schema_version } = data;
  if (schema_version !== 1 && schema_version !== 2) {
    throw new LockError(
      `schema_version 불일치: 기대 1|2, 실제 ${String(schema_version)}`,
      'SCHEMA',
    );
  }
  return parseLockV2Body(data);
}

/**
 * v3 lock JSON 을 파싱해 HarnessLockV3 를 반환한다.
 * v3 이외의 버전은 거부한다.
 */
export function parseLockV3(raw: string): HarnessLockV3 {
  const data = parseRawJson(raw);
  if (data['schema_version'] !== 3) {
    throw new LockError(
      `schema_version 불일치: 기대 3, 실제 ${String(data['schema_version'])}`,
      'SCHEMA',
    );
  }
  return parseLockV3Body(data);
}

/**
 * v1|v2|v3 lock JSON 을 파싱해 AnyHarnessLock 을 반환한다.
 * schema_version 을 보고 v2 또는 v3 파서로 디스패치한다.
 */
export function parseLock(raw: string): AnyHarnessLock {
  const data = parseRawJson(raw);
  const { schema_version } = data;
  if (schema_version === 1 || schema_version === 2) {
    return parseLockV2Body(data);
  }
  if (schema_version === 3) {
    return parseLockV3Body(data);
  }
  throw new LockError(
    `schema_version 불일치: 기대 1|2|3, 실제 ${String(schema_version)}`,
    'SCHEMA',
  );
}

export function readLock(lockPath?: string): AnyHarnessLock {
  const path = lockPath ?? defaultLockPath();
  if (!existsSync(path)) {
    throw new LockError(`harness.lock 없음: ${path}`, 'NOT_FOUND');
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new LockError(`읽기 실패: ${path} (${msg})`, 'IO');
  }
  return parseLock(raw);
}

export function getTool(lock: HarnessLock, name: ToolName): ToolEntry {
  return lock.tools[name];
}

// ── template & stamp utilities ───────────────────────────────────────────────

/**
 * 패키지 동봉된 harness.lock 템플릿 경로를 반환한다.
 * §15 C1: 빈 harness root 에서 install 즉시 실패하지 않도록 seedLockTemplate 가 참조.
 */
export function lockTemplatePath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'templates', 'harness.lock.template.json');
}

/**
 * 대상 lockPath 가 존재하지 않으면 템플릿을 복사해서 시드한다.
 * - 기존 파일은 덮어쓰지 않음 (비파괴 원칙)
 * - 부모 디렉토리는 자동 생성 (mkdirSync recursive)
 * §15 C1: install 의 첫 실패 UX 를 "에러 + 에디터 열어라" 로 개선.
 */
export function stampLockVersion(lockPath: string, version: string): void {
  if (!existsSync(lockPath)) return;
  let raw: string;
  try {
    raw = stripBom(readFileSync(lockPath, 'utf8'));
  } catch {
    return;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return;
  const next = { ...(data as Record<string, unknown>), acorn_version: version };
  const tmp = `${lockPath}.acorn-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o644 });
    renameSync(tmp, lockPath);
  } catch {
    try { unlinkSync(tmp); } catch { /* best effort cleanup */ }
  }
}

export function seedLockTemplate(lockPath: string): { seeded: boolean; templatePath: string } {
  const templatePath = lockTemplatePath();
  if (existsSync(lockPath)) return { seeded: false, templatePath };
  if (!existsSync(templatePath)) {
    throw new LockError(
      `내장 템플릿 누락: ${templatePath} (패키지 무결성 이상)`,
      'IO',
    );
  }
  mkdirSync(dirname(lockPath), { recursive: true });
  const raw = readFileSync(templatePath, 'utf8');
  writeFileSync(lockPath, raw, 'utf8');
  return { seeded: true, templatePath };
}
