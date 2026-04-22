import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { vendorsRoot } from './env.ts';
import { getProvider } from './providers.ts';

export type DetectState = 'installed' | 'missing' | 'unknown';

export interface DetectResult {
  readonly provider: string;
  readonly state: DetectState;
  readonly detail?: string;
}

export interface DetectEnv {
  readonly harnessRoot: string;
  readonly dirExists: (path: string) => boolean;
  readonly commandExists: (cmd: string) => boolean;
}

export function defaultDetectEnv(harnessRoot: string): DetectEnv {
  return {
    harnessRoot,
    dirExists: (p) => existsSync(p),
    commandExists: (cmd) => {
      try {
        execFileSync('which', [cmd], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function detectProvider(providerName: string, env: DetectEnv): DetectResult {
  const def = getProvider(providerName);
  if (!def) {
    return { provider: providerName, state: 'unknown', detail: 'not in registry' };
  }

  const strategy = def.primaryStrategy;

  if (strategy === 'clone') {
    const vRoot = vendorsRoot(env.harnessRoot);
    const vendorPath = join(vRoot, def.name);
    const exists = env.dirExists(vendorPath);
    if (exists) return { provider: providerName, state: 'installed', detail: vendorPath };
    return { provider: providerName, state: 'missing' };
  }

  if (strategy === 'npx' || strategy === 'npm-global') {
    if (!def.command) {
      return { provider: providerName, state: 'unknown', detail: 'no command defined' };
    }
    const found = env.commandExists(def.command);
    if (found) return { provider: providerName, state: 'installed', detail: `${def.command} in PATH` };
    return { provider: providerName, state: 'missing' };
  }

  return {
    provider: providerName,
    state: 'unknown',
    detail: `strategy ${strategy} is not auto-detectable`,
  };
}
