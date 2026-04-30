import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { defaultHarnessRoot } from './env.ts';
import { stripBom } from './bom.ts';
import { CAPABILITY_NAMES, type CapabilityName } from './lock.ts';
import { AcornError } from './errors.ts';

/**
 * v0.9.5+: 사용자 정의 Provider 레지스트리 로더.
 *
 * 출처(precedence, 낮음 → 높음):
 *   1. builtin (`providers.ts` 의 4 개)
 *   2. ACORN_EXTRA_PROVIDERS 환경변수 (콜론(:) 또는 OS 경로 구분자로 분리된 *.json 경로)
 *   3. 디스크 (`<harnessRoot>/providers/*.json`)
 *
 * 같은 `name` 이 여러 출처에 있으면 더 높은 출처가 우선하고 warning 을 누적.
 *
 * 보안: 사용자 정의 provider 는 `acorn config provider.allow-custom true`
 * 로 명시 opt-in 후에만 install_cmd 가 실행된다. 정책 검사는 호출 측 책임 —
 * 로더는 source 만 보고한다.
 */

// ── ProviderDef + helpers (providers.ts 와 공유 — circular import 회피) ──────

export type InstallStrategy = 'clone' | 'npx' | 'npm-global' | 'plugin-marketplace' | 'manual';
const STRATEGIES: readonly InstallStrategy[] = [
  'clone',
  'npx',
  'npm-global',
  'plugin-marketplace',
  'manual',
];

export type CapabilityStrength = 'primary' | 'secondary' | 'partial';
const STRENGTHS: readonly CapabilityStrength[] = ['primary', 'secondary', 'partial'];

export interface CapabilityProvision {
  readonly name: CapabilityName;
  readonly strength: CapabilityStrength;
}

export interface ProviderDef {
  readonly name: string;
  readonly displayName: string;
  readonly capabilities: readonly CapabilityProvision[];
  readonly strategies: readonly InstallStrategy[];
  readonly primaryStrategy: InstallStrategy;
  readonly repo?: string;
  readonly packageName?: string;
  readonly command?: string;
}

// ── source tracking ──────────────────────────────────────────────────────────

export type ProviderSource = 'builtin' | 'env' | 'user-file';

export interface LoadedProvider {
  readonly def: ProviderDef;
  readonly source: ProviderSource;
  readonly path?: string;
}

export interface ProviderLoadResult {
  readonly providers: readonly LoadedProvider[];
  readonly warnings: readonly string[];
}

// ── error type ───────────────────────────────────────────────────────────────

export type ProviderLoaderErrorCode = 'PARSE' | 'SCHEMA' | 'IO';

export class ProviderLoaderError extends AcornError<ProviderLoaderErrorCode> {
  constructor(
    message: string,
    code: ProviderLoaderErrorCode,
    hint?: string,
    docsUrl?: string,
  ) {
    super(message, { namespace: 'provider', code, hint, docsUrl });
    this.name = 'ProviderLoaderError';
  }
}

// ── schema validation ────────────────────────────────────────────────────────

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fail(label: string, msg: string): never {
  throw new ProviderLoaderError(
    `[${label}] ${msg}`,
    'SCHEMA',
    'provider 정의 스키마 — name, displayName, capabilities, strategies, primaryStrategy 필드 확인',
  );
}

function validateCapabilityProvision(label: string, raw: unknown, idx: number): CapabilityProvision {
  if (!isObject(raw)) fail(label, `capabilities[${idx}]: object 가 아닙니다`);
  const n = raw['name'];
  const s = raw['strength'];
  if (typeof n !== 'string' || !(CAPABILITY_NAMES as readonly string[]).includes(n)) {
    fail(label, `capabilities[${idx}].name: ${CAPABILITY_NAMES.join('|')} 중 하나여야 합니다 (입력=${JSON.stringify(n)})`);
  }
  if (typeof s !== 'string' || !(STRENGTHS as readonly string[]).includes(s)) {
    fail(label, `capabilities[${idx}].strength: ${STRENGTHS.join('|')} 중 하나여야 합니다 (입력=${JSON.stringify(s)})`);
  }
  return { name: n as CapabilityName, strength: s as CapabilityStrength };
}

export function validateProviderDef(label: string, raw: unknown): ProviderDef {
  if (!isObject(raw)) fail(label, '루트가 object 가 아닙니다');

  const { name, displayName, capabilities, strategies, primaryStrategy, repo, packageName, command } = raw;

  if (typeof name !== 'string' || !NAME_RE.test(name)) {
    fail(label, `name: ${NAME_RE.source} 형식이어야 합니다 (입력=${JSON.stringify(name)})`);
  }
  if (typeof displayName !== 'string' || displayName.length === 0) {
    fail(label, 'displayName: 비어있지 않은 문자열이어야 합니다');
  }
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    fail(label, 'capabilities: 비어있지 않은 배열이어야 합니다');
  }
  const caps: CapabilityProvision[] = capabilities.map((c, i) =>
    validateCapabilityProvision(label, c, i),
  );

  if (!Array.isArray(strategies) || strategies.length === 0) {
    fail(label, 'strategies: 비어있지 않은 배열이어야 합니다');
  }
  const strats: InstallStrategy[] = [];
  for (let i = 0; i < strategies.length; i++) {
    const s = strategies[i];
    if (typeof s !== 'string' || !(STRATEGIES as readonly string[]).includes(s)) {
      fail(label, `strategies[${i}]: ${STRATEGIES.join('|')} 중 하나여야 합니다 (입력=${JSON.stringify(s)})`);
    }
    strats.push(s as InstallStrategy);
  }

  if (typeof primaryStrategy !== 'string' || !(strats as readonly string[]).includes(primaryStrategy)) {
    fail(label, `primaryStrategy: strategies 안에 포함되어야 합니다 (입력=${JSON.stringify(primaryStrategy)})`);
  }

  if (repo !== undefined) {
    if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
      fail(label, `repo: "owner/name" 형식이어야 합니다 (입력=${JSON.stringify(repo)})`);
    }
  }
  if (packageName !== undefined) {
    if (typeof packageName !== 'string' || packageName.length === 0) {
      fail(label, 'packageName: 비어있지 않은 문자열이어야 합니다');
    }
  }
  if (command !== undefined) {
    if (typeof command !== 'string' || command.length === 0) {
      fail(label, 'command: 비어있지 않은 문자열이어야 합니다');
    }
  }

  if (strats.includes('clone') && repo === undefined) {
    fail(label, 'strategies 에 "clone" 이 있으면 repo 필드 필수');
  }
  if ((strats.includes('npx') || strats.includes('npm-global')) && packageName === undefined) {
    fail(label, 'strategies 에 "npx" 또는 "npm-global" 이 있으면 packageName 필수');
  }

  const def: ProviderDef = {
    name,
    displayName,
    capabilities: caps,
    strategies: strats,
    primaryStrategy: primaryStrategy as InstallStrategy,
    ...(repo !== undefined ? { repo: repo as string } : {}),
    ...(packageName !== undefined ? { packageName: packageName as string } : {}),
    ...(command !== undefined ? { command: command as string } : {}),
  };
  return def;
}

// ── filesystem helpers ───────────────────────────────────────────────────────

export function defaultProvidersDir(harnessRoot?: string): string {
  return join(harnessRoot ?? defaultHarnessRoot(), 'providers');
}

function readJsonFile(path: string): unknown {
  const raw = readFileSync(path, 'utf8');
  const stripped = stripBom(raw);
  try {
    return JSON.parse(stripped);
  } catch (e) {
    throw new ProviderLoaderError(
      `JSON 파싱 실패: ${path} (${e instanceof Error ? e.message : String(e)})`,
      'PARSE',
    );
  }
}

function readProviderFile(path: string, source: ProviderSource): LoadedProvider {
  const raw = readJsonFile(path);
  const def = validateProviderDef(path, raw);
  return { def, source, ...(source === 'user-file' ? { path } : {}) };
}

function listJsonFiles(dir: string): readonly string[] {
  if (!existsSync(dir)) return [];
  let entries: readonly string[];
  try {
    entries = readdirSync(dir);
  } catch (e) {
    throw new ProviderLoaderError(
      `providers 디렉토리 읽기 실패: ${dir} (${e instanceof Error ? e.message : String(e)})`,
      'IO',
    );
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.toLowerCase().endsWith('.json')) continue;
    const full = join(dir, entry);
    try {
      const st = statSync(full);
      if (st.isFile()) files.push(full);
    } catch {
      // 통계 실패는 skip — read 단계에서 다시 잡힘
    }
  }
  files.sort();
  return files;
}

function parseEnvPaths(raw: string): readonly string[] {
  // Split on `:` (POSIX) or `;` (Windows). 빈 토큰은 무시.
  return raw
    .split(/[:;]/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// ── main loader ──────────────────────────────────────────────────────────────

export interface LoadProvidersOptions {
  readonly harnessRoot?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** 내장 provider 목록 — providers.ts 가 주입 (circular import 회피) */
  readonly builtins: readonly ProviderDef[];
}

export function loadProviders(opts: LoadProvidersOptions): ProviderLoadResult {
  const env = opts.env ?? process.env;
  const warnings: string[] = [];
  const byName = new Map<string, LoadedProvider>();

  // 1) builtin (lowest precedence)
  for (const def of opts.builtins) {
    byName.set(def.name, { def, source: 'builtin' });
  }

  // 2) env (overrides builtin, lower than user-file)
  const envRaw = env['ACORN_EXTRA_PROVIDERS'];
  if (envRaw !== undefined && envRaw !== '') {
    for (const path of parseEnvPaths(envRaw)) {
      let loaded: LoadedProvider;
      try {
        loaded = readProviderFile(path, 'env');
      } catch (e) {
        if (e instanceof ProviderLoaderError) throw e;
        throw new ProviderLoaderError(
          `provider 파일 읽기 실패: ${path} (${e instanceof Error ? e.message : String(e)})`,
          'IO',
        );
      }
      const existing = byName.get(loaded.def.name);
      if (existing) {
        warnings.push(
          `provider "${loaded.def.name}": ${existing.source} 정의를 ACORN_EXTRA_PROVIDERS (${path}) 로 덮어씁니다.`,
        );
      }
      byName.set(loaded.def.name, loaded);
    }
  }

  // 3) disk (highest precedence)
  const dir = defaultProvidersDir(opts.harnessRoot);
  const files = listJsonFiles(dir);
  for (const file of files) {
    let loaded: LoadedProvider;
    try {
      loaded = readProviderFile(file, 'user-file');
    } catch (e) {
      if (e instanceof ProviderLoaderError) throw e;
      throw new ProviderLoaderError(
        `provider 파일 읽기 실패: ${file} (${e instanceof Error ? e.message : String(e)})`,
        'IO',
      );
    }
    // 파일명과 def.name 일치 권고 (cross-check, mismatch 는 warn 만).
    const expected = basename(file, '.json');
    if (expected !== loaded.def.name) {
      warnings.push(
        `provider "${loaded.def.name}": 파일명 "${expected}.json" 과 name 필드가 다릅니다.`,
      );
    }
    const existing = byName.get(loaded.def.name);
    if (existing) {
      warnings.push(
        `provider "${loaded.def.name}": ${existing.source} 정의를 사용자 파일 (${file}) 로 덮어씁니다.`,
      );
    }
    byName.set(loaded.def.name, loaded);
  }

  return {
    providers: [...byName.values()],
    warnings,
  };
}

// ── provider policy (allow-custom) ───────────────────────────────────────────

export interface ProviderPolicy {
  readonly allowCustomProviders: boolean;
}

export const DEFAULT_PROVIDER_POLICY: ProviderPolicy = {
  allowCustomProviders: false,
};

export function defaultAcornConfigPath(harnessRoot?: string): string {
  return join(harnessRoot ?? defaultHarnessRoot(), 'config.json');
}

export function readProviderPolicy(harnessRoot?: string): ProviderPolicy {
  const path = defaultAcornConfigPath(harnessRoot);
  if (!existsSync(path)) return DEFAULT_PROVIDER_POLICY;
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(readFileSync(path, 'utf8')));
  } catch (e) {
    throw new ProviderLoaderError(
      `acorn config.json 파싱 실패: ${path} (${e instanceof Error ? e.message : String(e)})`,
      'PARSE',
    );
  }
  if (!isObject(raw)) {
    throw new ProviderLoaderError(
      `acorn config.json: 루트가 object 가 아닙니다 (${path})`,
      'SCHEMA',
    );
  }
  const provider = raw['provider'];
  if (provider === undefined) return DEFAULT_PROVIDER_POLICY;
  if (!isObject(provider)) {
    throw new ProviderLoaderError(
      `acorn config.json: provider 필드는 object 여야 합니다 (${path})`,
      'SCHEMA',
    );
  }
  const allow = provider['allow_custom'];
  if (allow !== undefined && typeof allow !== 'boolean') {
    throw new ProviderLoaderError(
      `acorn config.json: provider.allow_custom 은 boolean 이어야 합니다 (입력=${typeof allow})`,
      'SCHEMA',
    );
  }
  return {
    allowCustomProviders: allow === true,
  };
}

export function writeProviderPolicy(policy: ProviderPolicy, harnessRoot?: string): string {
  const path = defaultAcornConfigPath(harnessRoot);
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });

  // 기존 다른 키 보존 — read-modify-write
  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(stripBom(readFileSync(path, 'utf8')));
      if (isObject(parsed)) existing = parsed;
    } catch {
      // 손상된 파일은 덮어쓰기보다 명시적 실패 — caller 가 read 먼저 호출하도록 유도.
      throw new ProviderLoaderError(
        `acorn config.json 손상 — 수동 수정 후 재시도: ${path}`,
        'SCHEMA',
      );
    }
  }
  const providerExisting = isObject(existing['provider']) ? existing['provider'] : {};
  const next = {
    ...existing,
    provider: { ...providerExisting, allow_custom: policy.allowCustomProviders },
  };
  const json = `${JSON.stringify(next, null, 2)}\n`;

  const tmp = `${path}.acorn-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, json, { encoding: 'utf8', mode: 0o644 });
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw new ProviderLoaderError(
      `acorn config.json 쓰기 실패: ${path} (${e instanceof Error ? e.message : String(e)})`,
      'IO',
    );
  }
  return path;
}
