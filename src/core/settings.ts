import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  existsSync,
  copyFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ENV_KEYS,
  defaultClaudeRoot,
  defaultHarnessRoot,
  type EnvKey,
  type EnvMap,
} from './env.ts';

export type SettingsErrorCode = 'PARSE' | 'CONFLICT' | 'IO';

export class SettingsError extends Error {
  readonly code: SettingsErrorCode;
  readonly conflicts?: readonly EnvConflict[] | undefined;
  constructor(
    message: string,
    code: SettingsErrorCode,
    conflicts?: readonly EnvConflict[],
  ) {
    super(message);
    this.name = 'SettingsError';
    this.code = code;
    this.conflicts = conflicts;
  }
}

export interface EnvConflict {
  readonly key: EnvKey;
  readonly current: string;
  readonly desired: string;
}

export type SettingsObject = Record<string, unknown>;

export function defaultSettingsPath(): string {
  return join(defaultClaudeRoot(), 'settings.json');
}

export function readSettings(path?: string): SettingsObject {
  const target = path ?? defaultSettingsPath();
  if (!existsSync(target)) {
    return {};
  }
  let raw: string;
  try {
    raw = readFileSync(target, 'utf8');
  } catch (e) {
    throw new SettingsError(
      `읽기 실패: ${target} (${e instanceof Error ? e.message : String(e)})`,
      'IO',
    );
  }
  if (raw.trim() === '') return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new SettingsError(
      `JSON 파싱 실패: ${target} (${e instanceof Error ? e.message : String(e)})`,
      'PARSE',
    );
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new SettingsError(`루트가 object 가 아닙니다: ${target}`, 'PARSE');
  }
  return data as SettingsObject;
}

export interface MergePlan {
  readonly action: 'noop' | 'add' | 'conflict';
  readonly toAdd: readonly EnvKey[];
  readonly conflicts: readonly EnvConflict[];
}

function getEnvSection(s: SettingsObject): Record<string, unknown> {
  const env = s['env'];
  if (typeof env === 'object' && env !== null && !Array.isArray(env)) {
    return env as Record<string, unknown>;
  }
  return {};
}

export function planMerge(current: SettingsObject, desired: EnvMap): MergePlan {
  const env = getEnvSection(current);
  const toAdd: EnvKey[] = [];
  const conflicts: EnvConflict[] = [];
  for (const key of ENV_KEYS) {
    const have = env[key];
    const want = desired[key];
    if (have === undefined) {
      toAdd.push(key);
    } else if (typeof have !== 'string') {
      conflicts.push({ key, current: String(have), desired: want });
    } else if (have !== want) {
      conflicts.push({ key, current: have, desired: want });
    }
  }
  let action: MergePlan['action'];
  if (conflicts.length > 0) action = 'conflict';
  else if (toAdd.length === 0) action = 'noop';
  else action = 'add';
  return { action, toAdd, conflicts };
}

export function mergeEnv(current: SettingsObject, desired: EnvMap): SettingsObject {
  const plan = planMerge(current, desired);
  if (plan.action === 'conflict') {
    throw new SettingsError(
      `env 키 충돌: ${plan.conflicts.map((c) => c.key).join(', ')}`,
      'CONFLICT',
      plan.conflicts,
    );
  }
  const currentEnv = getEnvSection(current);
  const newEnv = { ...currentEnv };
  for (const key of plan.toAdd) {
    newEnv[key] = desired[key];
  }
  return { ...current, env: newEnv };
}

/**
 * §15 v0.3.0 S4 / ADR-018 — adopt 경로의 conflict 처리.
 * 충돌 키를 `env.<key>.pre-adopt-<ts>` 로 이름 바꿔 보존하고 기대값으로 덮어쓴다.
 * 삭제 일절 없음, 복구 가능. 반환 값은 새 settings 객체 + 이동 기록.
 */
export interface AdoptMergeResult {
  readonly next: SettingsObject;
  readonly movedKeys: readonly { key: string; to: string }[];
  readonly addedKeys: readonly EnvKey[];
}

export function mergeEnvAdopt(
  current: SettingsObject,
  desired: EnvMap,
): AdoptMergeResult {
  const plan = planMerge(current, desired);
  const currentEnv = getEnvSection(current);
  const newEnv: Record<string, unknown> = { ...currentEnv };
  const ts = isoTimestamp();
  const movedKeys: { key: string; to: string }[] = [];
  for (const conflict of plan.conflicts) {
    const preserveKey = `${conflict.key}.pre-adopt-${ts}`;
    newEnv[preserveKey] = currentEnv[conflict.key];
    newEnv[conflict.key] = conflict.desired;
    movedKeys.push({ key: conflict.key, to: preserveKey });
  }
  for (const key of plan.toAdd) {
    newEnv[key] = desired[key];
  }
  return {
    next: { ...current, env: newEnv },
    movedKeys,
    addedKeys: plan.toAdd,
  };
}

function isoTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function defaultBackupRoot(harnessRoot?: string): string {
  return join(harnessRoot ?? defaultHarnessRoot(), 'backup');
}

export interface BackupResult {
  readonly backupPath: string | null;
  readonly skipped: boolean;
}

export function backupSettings(
  settingsPath: string,
  harnessRoot?: string,
  timestamp: string = isoTimestamp(),
): BackupResult {
  if (!existsSync(settingsPath)) {
    return { backupPath: null, skipped: true };
  }
  const dir = join(defaultBackupRoot(harnessRoot), timestamp);
  mkdirSync(dir, { recursive: true });
  const backupPath = join(dir, 'settings.json.bak');
  copyFileSync(settingsPath, backupPath);
  return { backupPath, skipped: false };
}

export function atomicWriteJson(path: string, data: SettingsObject): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.acorn-${process.pid}-${Date.now()}.tmp`;
  const json = `${JSON.stringify(data, null, 2)}\n`;
  try {
    writeFileSync(tmp, json, { encoding: 'utf8', mode: 0o644 });
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw new SettingsError(
      `원자적 쓰기 실패: ${path} (${e instanceof Error ? e.message : String(e)})`,
      'IO',
    );
  }
}

export interface InstallEnvOptions {
  readonly settingsPath?: string;
  readonly harnessRoot?: string;
  readonly desired: EnvMap;
  /** §15 S4: adopt — 충돌 키를 env.<key>.pre-adopt-<ts> 로 이동 후 기대값 덮어쓰기 */
  readonly adopt?: boolean;
}

export interface InstallEnvResult {
  readonly action: MergePlan['action'] | 'adopted';
  readonly added: readonly EnvKey[];
  readonly backupPath: string | null;
  readonly settingsPath: string;
  /** adopt 경로에서 이동된 충돌 키와 보존 경로 */
  readonly movedKeys?: readonly { key: string; to: string }[];
}

export function installEnv(opts: InstallEnvOptions): InstallEnvResult {
  const settingsPath = opts.settingsPath ?? defaultSettingsPath();
  const current = readSettings(settingsPath);
  const plan = planMerge(current, opts.desired);

  if (plan.action === 'conflict') {
    if (opts.adopt) {
      // §15 S4: 충돌 키를 pre-adopt 접미어로 이동하고 기대값 덮어쓰기.
      const backup = backupSettings(settingsPath, opts.harnessRoot);
      const adoptResult = mergeEnvAdopt(current, opts.desired);
      atomicWriteJson(settingsPath, adoptResult.next);
      return {
        action: 'adopted',
        added: adoptResult.addedKeys,
        backupPath: backup.backupPath,
        settingsPath,
        movedKeys: adoptResult.movedKeys,
      };
    }
    throw new SettingsError(
      `env 키 충돌 — 비파괴적 머지 불가: ${plan.conflicts
        .map((c) => `${c.key} (현재="${c.current}", 기대="${c.desired}")`)
        .join('; ')}`,
      'CONFLICT',
      plan.conflicts,
    );
  }

  if (plan.action === 'noop') {
    return {
      action: 'noop',
      added: [],
      backupPath: null,
      settingsPath,
    };
  }

  const backup = backupSettings(settingsPath, opts.harnessRoot);
  const merged = mergeEnv(current, opts.desired);
  atomicWriteJson(settingsPath, merged);

  return {
    action: 'add',
    added: plan.toAdd,
    backupPath: backup.backupPath,
    settingsPath,
  };
}
