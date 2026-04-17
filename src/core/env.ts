import { homedir } from 'node:os';
import { join } from 'node:path';

export const ENV_KEYS = ['CLAUDE_PLUGIN_ROOT', 'OMC_PLUGIN_ROOT', 'ECC_ROOT'] as const;
export type EnvKey = (typeof ENV_KEYS)[number];

export type EnvMap = Readonly<Record<EnvKey, string>>;

/**
 * §15 v0.4.1 #3 — 빈 문자열 환경변수도 fallback 한다.
 * 이전: `??` 는 nullish 만 통과시켜 `CLAUDE_CONFIG_DIR=''` / `ACORN_HARNESS_ROOT=''`
 * 가 그대로 새어나와 `join('', 'skills', 'harness')` → CWD 상대 `skills/harness`
 * 로 모든 write path (settings, lock, tx.log, hooks, vendors) 를 오염시켰다.
 * codex review (2026-04-18) 에서 포착. 이제 빈 문자열은 정의되지 않은 것으로 간주.
 */
function envOrDefault(key: string, fallback: string): string {
  const v = process.env[key];
  return v !== undefined && v !== '' ? v : fallback;
}

export function defaultClaudeRoot(): string {
  return envOrDefault('CLAUDE_CONFIG_DIR', join(homedir(), '.claude'));
}

export function defaultHarnessRoot(): string {
  return envOrDefault(
    'ACORN_HARNESS_ROOT',
    join(defaultClaudeRoot(), 'skills', 'harness'),
  );
}

export function vendorsRoot(harnessRoot?: string): string {
  return join(harnessRoot ?? defaultHarnessRoot(), 'vendors');
}

export function computeEnv(harnessRoot?: string): EnvMap {
  const vendors = vendorsRoot(harnessRoot);
  return {
    CLAUDE_PLUGIN_ROOT: vendors,
    OMC_PLUGIN_ROOT: join(vendors, 'omc'),
    ECC_ROOT: join(vendors, 'ecc'),
  };
}

export type EnvDiffStatus = 'match' | 'missing' | 'mismatch';

export interface EnvDiffEntry {
  readonly key: EnvKey;
  readonly expected: string;
  readonly actual: string | undefined;
  readonly status: EnvDiffStatus;
}

export type EnvSource = Readonly<Record<string, string | undefined>>;

export function diffEnv(
  expected: EnvMap,
  actual: EnvSource = process.env,
): readonly EnvDiffEntry[] {
  return ENV_KEYS.map((key) => {
    const exp = expected[key];
    const act = actual[key];
    let status: EnvDiffStatus;
    if (act === undefined || act === '') {
      status = 'missing';
    } else if (act === exp) {
      status = 'match';
    } else {
      status = 'mismatch';
    }
    return { key, expected: exp, actual: act, status };
  });
}

export function isEnvFullyMatched(diff: readonly EnvDiffEntry[]): boolean {
  return diff.every((e) => e.status === 'match');
}
