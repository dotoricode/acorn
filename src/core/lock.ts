import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultHarnessRoot } from './env.ts';
import { stripBom } from './bom.ts';

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

const SHA1_RE = /^[a-f0-9]{40}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * §15 HIGH-2 / ADR-020 (v0.4.0): repo allowlist 검증.
 * `ACORN_ALLOW_ANY_REPO=1` 이면 검증 skip (escape hatch).
 * `parseLock` 호출 시점에 process.env 를 읽어 결정 — env 기반이라
 * 테스트는 env 조작으로 양 케이스 확인 가능.
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

export function parseLock(raw: string): HarnessLock {
  // Windows 에디터가 UTF-8 BOM 을 삽입한 경우 JSON.parse 가 실패한다.
  // fail-close 원칙 위반 없이 조용히 제거한다. (DOGFOOD Round 1 §v0.1.1 #1)
  // v0.4.1: stripBom 을 core/bom.ts 로 통합.
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

  const { schema_version, acorn_version, tools, guard } = data;

  // 누락과 불일치를 구분. undefined 일 때 "기대 2, 실제 undefined" 표시는
  // 필드 자체가 없는 건지 잘못 찍은 건지 구분이 안 되어 혼란을 줌.
  // (DOGFOOD Round 1 §v0.1.1 #2)
  if (!('schema_version' in data)) {
    throw new LockError('schema_version 필드 누락', 'SCHEMA');
  }
  // v0.8.0: v1(기존) 을 in-memory v2 로 투명 마이그레이션. v1/v2 외 버전은 거부.
  if (schema_version !== 1 && schema_version !== SCHEMA_VERSION) {
    throw new LockError(
      `schema_version 불일치: 기대 ${SCHEMA_VERSION}, 실제 ${String(schema_version)}`,
      'SCHEMA',
    );
  }
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

export function readLock(lockPath?: string): HarnessLock {
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

/**
 * 패키지 동봉된 harness.lock 템플릿 경로를 반환한다.
 * - dev (src/core/lock.ts 실행): `<repo>/templates/harness.lock.template.json`
 * - prod (dist/core/lock.js 실행): 같은 상대 경로로 해소됨
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
 * - BOM 없이 utf8 로 기록
 * §15 C1: install 의 첫 실패 UX 를 "에러 + 에디터 열어라" 로 개선.
 */
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
