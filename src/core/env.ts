import { homedir } from 'node:os';
import { join } from 'node:path';

export const ENV_KEYS = ['CLAUDE_PLUGIN_ROOT', 'OMC_PLUGIN_ROOT', 'ECC_ROOT'] as const;
export type EnvKey = (typeof ENV_KEYS)[number];

export type EnvMap = Readonly<Record<EnvKey, string>>;

export function defaultHarnessRoot(): string {
  return (
    process.env['ACORN_HARNESS_ROOT'] ??
    join(homedir(), '.claude', 'skills', 'harness')
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
