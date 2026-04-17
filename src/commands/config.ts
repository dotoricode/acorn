import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  readLock,
  parseLock,
  defaultLockPath,
  GUARD_MODES,
  GUARD_PATTERNS,
  type GuardMode,
  type GuardPatterns,
} from '../core/lock.ts';
import {
  readSettings,
  atomicWriteJson,
  backupSettings,
  defaultSettingsPath,
  defaultBackupRoot,
} from '../core/settings.ts';
import { defaultHarnessRoot } from '../core/env.ts';

/**
 * §15 v0.3.0 S3 — acorn config 오케스트레이터.
 * Round 1 도그푸딩에서 "jq 저글링 대신 직접 편집 툴 필요" 로 나온 요구.
 * 원칙: preflight (새 값 schema 검증) → backup → atomic write.
 */

export type ConfigErrorCode =
  | 'UNKNOWN_KEY'
  | 'SCHEMA'
  | 'IO'
  | 'CONFIRM_REQUIRED';

export class ConfigError extends Error {
  readonly code: ConfigErrorCode;
  readonly hint?: string;
  constructor(message: string, code: ConfigErrorCode, hint?: string) {
    super(message);
    this.name = 'ConfigError';
    this.code = code;
    if (hint !== undefined) this.hint = hint;
  }
}

export type ConfigAction =
  | { kind: 'get'; key: string; value: string }
  | { kind: 'set'; key: string; from: string; to: string; backup: string | null }
  | { kind: 'noop'; key: string; value: string }
  | {
      kind: 'reset';
      key: 'env.reset';
      removedKeys: readonly string[];
      backup: string | null;
    }
  | { kind: 'cancelled'; key: string; from?: string; to?: string }
  | { kind: 'summary'; lock: { guardMode: GuardMode; guardPatterns: GuardPatterns } };

export type ConfirmFn = (prompt: string) => boolean;

export interface ConfigOptions {
  readonly lockPath?: string;
  readonly settingsPath?: string;
  readonly harnessRoot?: string;
  /** `--yes` 플래그 — 확인 프롬프트 스킵 */
  readonly yes?: boolean;
  /**
   * 확인 callback. TTY 환경에선 readline wrapper 주입.
   * 미지정 + yes=false 이면 CONFIRM_REQUIRED throw (non-TTY/CI 가정).
   */
  readonly confirm?: ConfirmFn;
}

function isoTs(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function backupLock(lockPath: string, harnessRoot: string): string {
  const dir = join(defaultBackupRoot(harnessRoot), isoTs(), 'config', 'lock');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${basename(lockPath)}.bak`);
  copyFileSync(lockPath, dest);
  return dest;
}

function writeLockAtomic(
  lockPath: string,
  newContent: string,
): void {
  const dir = dirname(lockPath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${lockPath}.acorn-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, newContent, { encoding: 'utf8', mode: 0o644 });
    renameSync(tmp, lockPath);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw new ConfigError(
      `lock 쓰기 실패: ${lockPath} (${e instanceof Error ? e.message : String(e)})`,
      'IO',
    );
  }
}

function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}

function requireConfirm(
  prompt: string,
  opts: ConfigOptions,
): boolean {
  if (opts.yes) return true;
  if (!opts.confirm) {
    throw new ConfigError(
      `확인 프롬프트 불가 (non-TTY 또는 CI). --yes 플래그로 명시적 승인 필요`,
      'CONFIRM_REQUIRED',
      'acorn config <key> <value> --yes',
    );
  }
  return opts.confirm(prompt);
}

function setGuardField(
  field: 'mode' | 'patterns',
  allowed: readonly string[],
  value: string,
  opts: ConfigOptions,
): ConfigAction {
  const lockPath = opts.lockPath ?? defaultLockPath();
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();

  if (!allowed.includes(value)) {
    throw new ConfigError(
      `guard.${field}: ${allowed.join('|')} 중 하나여야 합니다 (입력="${value}")`,
      'SCHEMA',
    );
  }

  const lock = readLock(lockPath);
  const current = lock.guard[field];

  if (current === value) {
    return { kind: 'noop', key: `guard.${field}`, value };
  }

  const prompt = `guard.${field}: ${current} → ${value} 변경하시겠습니까?`;
  if (!requireConfirm(prompt, opts)) {
    return { kind: 'cancelled', key: `guard.${field}`, from: current, to: value };
  }

  // Read / mutate / re-validate / atomic write
  const raw = readFileSync(lockPath, 'utf8');
  const stripped = stripBom(raw);
  const data = JSON.parse(stripped) as Record<string, unknown>;
  if (typeof data['guard'] !== 'object' || data['guard'] === null) {
    throw new ConfigError(
      `lock 에 guard 객체가 없거나 형식이 잘못됨: ${lockPath}`,
      'SCHEMA',
    );
  }
  const guard = { ...(data['guard'] as Record<string, unknown>), [field]: value };
  const newData = { ...data, guard };
  const newJson = `${JSON.stringify(newData, null, 2)}\n`;

  // parseLock 로 재검증 (schema 보장)
  parseLock(newJson);

  const backup = backupLock(lockPath, harnessRoot);
  writeLockAtomic(lockPath, newJson);

  return {
    kind: 'set',
    key: `guard.${field}`,
    from: current,
    to: value,
    backup,
  };
}

function getGuardField(
  field: 'mode' | 'patterns',
  opts: ConfigOptions,
): ConfigAction {
  const lockPath = opts.lockPath ?? defaultLockPath();
  const lock = readLock(lockPath);
  return { kind: 'get', key: `guard.${field}`, value: lock.guard[field] };
}

function resetEnv(opts: ConfigOptions): ConfigAction {
  const settingsPath = opts.settingsPath ?? defaultSettingsPath();
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();

  if (!existsSync(settingsPath)) {
    return {
      kind: 'reset',
      key: 'env.reset',
      removedKeys: [],
      backup: null,
    };
  }

  const current = readSettings(settingsPath);
  const env = current['env'];
  if (typeof env !== 'object' || env === null || Array.isArray(env)) {
    return {
      kind: 'reset',
      key: 'env.reset',
      removedKeys: [],
      backup: null,
    };
  }

  const envRecord = env as Record<string, unknown>;
  const targets = ['CLAUDE_PLUGIN_ROOT', 'OMC_PLUGIN_ROOT', 'ECC_ROOT'];
  const removed = targets.filter((k) => k in envRecord);

  if (removed.length === 0) {
    return {
      kind: 'reset',
      key: 'env.reset',
      removedKeys: [],
      backup: null,
    };
  }

  const prompt = `settings.json 에서 env 3키 제거 (${removed.join(', ')})?`;
  if (!requireConfirm(prompt, opts)) {
    return {
      kind: 'cancelled',
      key: 'env.reset',
    };
  }

  const newEnv: Record<string, unknown> = { ...envRecord };
  for (const k of targets) delete newEnv[k];
  const newData = { ...current, env: newEnv };

  const backupResult = backupSettings(settingsPath, harnessRoot);
  atomicWriteJson(settingsPath, newData);

  return {
    kind: 'reset',
    key: 'env.reset',
    removedKeys: removed,
    backup: backupResult.backupPath,
  };
}

function summary(opts: ConfigOptions): ConfigAction {
  const lockPath = opts.lockPath ?? defaultLockPath();
  const lock = readLock(lockPath);
  return {
    kind: 'summary',
    lock: { guardMode: lock.guard.mode, guardPatterns: lock.guard.patterns },
  };
}

/**
 * Router — argv[0] = key (optional), argv[1] = value (optional).
 * 지원 키: guard.mode / guard.patterns / env.reset.
 */
export function runConfig(
  key: string | undefined,
  value: string | undefined,
  opts: ConfigOptions = {},
): ConfigAction {
  if (!key) {
    return summary(opts);
  }
  if (key === 'guard.mode') {
    if (value === undefined) return getGuardField('mode', opts);
    return setGuardField('mode', GUARD_MODES, value, opts);
  }
  if (key === 'guard.patterns') {
    if (value === undefined) return getGuardField('patterns', opts);
    return setGuardField('patterns', GUARD_PATTERNS, value, opts);
  }
  if (key === 'env.reset') {
    // env.reset 은 action — value 무시
    return resetEnv(opts);
  }
  throw new ConfigError(
    `알 수 없는 config key: "${key}". 지원: guard.mode / guard.patterns / env.reset`,
    'UNKNOWN_KEY',
  );
}

export function renderConfigAction(a: ConfigAction): string {
  switch (a.kind) {
    case 'get':
      return `${a.key}: ${a.value}`;
    case 'noop':
      return `= ${a.key}: ${a.value} (변경 없음)`;
    case 'set':
      return (
        `✅ ${a.key}: ${a.from} → ${a.to}` +
        (a.backup ? `\n   backup: ${a.backup}` : '')
      );
    case 'reset':
      if (a.removedKeys.length === 0) {
        return '= env.reset: 제거할 env 키 없음';
      }
      return (
        `✅ env.reset: 제거된 키 [${a.removedKeys.join(', ')}]` +
        (a.backup ? `\n   backup: ${a.backup}` : '')
      );
    case 'cancelled':
      return `취소됨: ${a.key}${a.from && a.to ? ` (${a.from} → ${a.to})` : ''}`;
    case 'summary':
      return (
        `guard.mode:     ${a.lock.guardMode}\n` +
        `guard.patterns: ${a.lock.guardPatterns}`
      );
  }
}
