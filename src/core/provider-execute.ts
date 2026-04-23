import { spawnSync } from 'node:child_process';
import { installVendor, type GitRunner } from './vendors.ts';
import { vendorsRoot } from './env.ts';
import type { HarnessLockV3 } from './lock.ts';

const PLACEHOLDER_SHA = '0'.repeat(40);

export type ProviderExecAction =
  | 'cloned'
  | 'noop'
  | 'npx-ran'
  | 'skipped-placeholder';

export interface ProviderExecResult {
  readonly provider: string;
  readonly action: ProviderExecAction;
  readonly commit?: string;
  readonly detail?: string;
}

export interface NpxRunner {
  run(cmd: string): void;
}

export function defaultNpxRunner(): NpxRunner {
  return {
    run(cmd) {
      const parts = cmd.trim().split(/\s+/);
      const prog = parts[0];
      const args = parts.slice(1);
      const res = spawnSync(prog, args, { stdio: 'inherit', shell: false });
      if (res.error) throw res.error;
      if (typeof res.status === 'number' && res.status !== 0) {
        throw new Error(`"${cmd}" exited with code ${res.status}`);
      }
    },
  };
}

export function collectActiveProviders(lock: HarnessLockV3): Set<string> {
  const active = new Set<string>();
  for (const cap of Object.values(lock.capabilities)) {
    for (const name of cap.providers) {
      active.add(name);
    }
  }
  return active;
}

export interface ExecuteV3ProvidersOptions {
  readonly harnessRoot: string;
  readonly git: GitRunner;
  readonly adopt?: boolean;
  readonly followSymlink?: boolean;
  readonly npxRunner?: NpxRunner;
  readonly log: (line: string) => void;
}

export function executeV3Providers(
  lock: HarnessLockV3,
  opts: ExecuteV3ProvidersOptions,
): readonly ProviderExecResult[] {
  const active = collectActiveProviders(lock);
  const npx = opts.npxRunner ?? defaultNpxRunner();
  const vRoot = vendorsRoot(opts.harnessRoot);
  const results: ProviderExecResult[] = [];

  for (const [name, entry] of Object.entries(lock.providers)) {
    if (!active.has(name)) {
      opts.log(`  [skip] ${name}: not referenced in any capability`);
      continue;
    }

    if (entry.install_strategy === 'git-clone') {
      if (entry.commit === PLACEHOLDER_SHA) {
        results.push({ provider: name, action: 'skipped-placeholder' });
        opts.log(`  [skip] ${name}: placeholder SHA — update harness.lock before installing`);
        continue;
      }
      const r = installVendor({
        tool: name,
        repo: entry.repo,
        commit: entry.commit,
        vendorsRoot: vRoot,
        git: opts.git,
        adopt: opts.adopt ?? false,
        followSymlink: opts.followSymlink ?? false,
      });
      const action: ProviderExecAction = r.action === 'noop' ? 'noop' : 'cloned';
      results.push({ provider: name, action, commit: r.commit });
      opts.log(`  ${name}: ${r.action} (${r.commit.slice(0, 7)})`);
    } else {
      const cmd = entry.install_cmd;
      try {
        npx.run(cmd);
        results.push({ provider: name, action: 'npx-ran', detail: cmd });
        opts.log(`  ${name}: ran "${cmd}"`);
      } catch (e) {
        throw new Error(
          `Provider "${name}" install failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  return results;
}
