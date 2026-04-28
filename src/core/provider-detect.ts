import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { vendorsRoot } from './env.ts';
import { getProvider } from './providers.ts';

/**
 * v0.9.3+: npm provider version drift 검출.
 * `npm view <pkg> version --json` 결과를 lock 의 `version` 과 비교.
 * 네트워크/registry 실패 시 graceful skip — 'unknown' 으로 보고하고 doctor 가 무시.
 */
export type VersionDriftState = 'match' | 'drift' | 'unknown';

export interface VersionDriftResult {
  readonly state: VersionDriftState;
  readonly lockVersion: string;
  readonly latestVersion?: string;
  readonly detail?: string;
}

export interface NpmRunner {
  /**
   * Returns the latest published version of `pkg`, or null on failure.
   * Implementations should swallow network errors and return null.
   */
  latestVersion(pkg: string): string | null;
}

export function defaultNpmRunner(): NpmRunner {
  return {
    latestVersion(pkg) {
      try {
        const out = execFileSync('npm', ['view', pkg, 'version', '--json'], {
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: 5000,
        }).toString().trim();
        // npm view returns either "1.2.3" or {error}. Parse defensively.
        const v = JSON.parse(out);
        return typeof v === 'string' ? v : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Pure comparator for testability. Returns 'match' iff lock and latest are
 * identical strings (no semver coercion — exact pin is the contract).
 */
export function compareNpmVersion(
  lockVersion: string,
  latestVersion: string | null,
): VersionDriftResult {
  if (latestVersion === null) {
    return { state: 'unknown', lockVersion, detail: 'npm view 실패 (네트워크/권한)' };
  }
  if (lockVersion === latestVersion) {
    return { state: 'match', lockVersion, latestVersion };
  }
  return {
    state: 'drift',
    lockVersion,
    latestVersion,
    detail: `lock: ${lockVersion} → registry: ${latestVersion}`,
  };
}

/**
 * Extract npm package name from `install_cmd` like "npx claudekit@latest setup --yes"
 * → "claudekit". Returns null if the command does not look like an npx invocation.
 */
export function extractNpmPackage(installCmd: string): string | null {
  // Strip leading runner: "npx ", "npm exec ", "pnpm dlx ", "yarn dlx "
  const stripped = installCmd
    .trim()
    .replace(/^(npx|npm\s+exec|pnpm\s+dlx|yarn\s+dlx)\s+/i, '');
  // First token before whitespace = package spec ("name@version" or "name")
  const spec = stripped.split(/\s+/, 1)[0];
  if (!spec) return null;
  // Strip trailing @version (including @scope/pkg@version)
  // Scoped: @scope/name OR @scope/name@version
  // Unscoped: name OR name@version
  if (spec.startsWith('@')) {
    const slashIdx = spec.indexOf('/');
    if (slashIdx === -1) return null;
    const rest = spec.slice(slashIdx + 1);
    const atIdx = rest.indexOf('@');
    return atIdx === -1 ? spec : `${spec.slice(0, slashIdx + 1)}${rest.slice(0, atIdx)}`;
  }
  const atIdx = spec.indexOf('@');
  return atIdx === -1 ? spec : spec.slice(0, atIdx);
}

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

  if (strategy === 'plugin-marketplace') {
    // v0.9.2: plugin marketplace 는 Claude Code 내부 명령으로만 설치/제거가 가능.
    // acorn 은 status 만 안내 — 실제 설치 검증은 사용자 책임.
    return {
      provider: providerName,
      state: 'unknown',
      detail: 'plugin marketplace — Claude Code 세션에서 /plugin install 로 확인 필요',
    };
  }

  return {
    provider: providerName,
    state: 'unknown',
    detail: `strategy ${strategy} is not auto-detectable`,
  };
}
