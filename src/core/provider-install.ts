import { join } from 'node:path';
import { getProvider, type InstallStrategy, type ProviderDef } from './providers.ts';

export type InstallStepKind = 'info' | 'shell' | 'git-clone' | 'symlink';

export interface InstallStep {
  readonly kind: InstallStepKind;
  readonly description: string;
  readonly command?: string;
  readonly from?: string;
  readonly to?: string;
}

export interface InstallPlan {
  readonly provider: string;
  readonly strategy: InstallStrategy | 'manual';
  readonly steps: readonly InstallStep[];
  readonly notes?: string;
}

export interface BuildInstallPlanOptions {
  readonly harnessRoot?: string;
  readonly claudeRoot?: string;
  readonly preferStrategy?: InstallStrategy;
}

function clonePlan(def: ProviderDef, harnessRoot: string, claudeRoot: string): InstallPlan {
  const vendorPath = join(harnessRoot, 'vendors', def.name);
  const steps: InstallStep[] = [];

  if (def.repo) {
    steps.push({
      kind: 'git-clone',
      description: `Clone ${def.repo}`,
      command: `git clone https://github.com/${def.repo}.git ${vendorPath}`,
    });
  }

  if (def.name === 'gstack') {
    const linkTarget = join(claudeRoot, 'skills', 'gstack');
    steps.push({
      kind: 'symlink',
      description: `Link gstack into Claude skills`,
      from: vendorPath,
      to: linkTarget,
    });
  }

  return { provider: def.name, strategy: 'clone', steps };
}

function npxPlan(def: ProviderDef): InstallPlan {
  const pkg = def.packageName ?? def.name;
  return {
    provider: def.name,
    strategy: 'npx',
    steps: [
      {
        kind: 'info',
        description: `${def.displayName} runs via npx — no persistent install required`,
      },
      {
        kind: 'shell',
        description: `Verify access`,
        command: `npx ${pkg} --version`,
      },
    ],
    notes: `Invoke on demand: npx ${pkg}`,
  };
}

function npmGlobalPlan(def: ProviderDef): InstallPlan {
  const pkg = def.packageName ?? def.name;
  return {
    provider: def.name,
    strategy: 'npm-global',
    steps: [
      {
        kind: 'shell',
        description: `Install ${def.displayName} globally`,
        command: `npm install -g ${pkg}`,
      },
    ],
  };
}

export function buildInstallPlan(
  providerName: string,
  opts: BuildInstallPlanOptions = {},
): InstallPlan {
  const def = getProvider(providerName);
  if (!def) {
    return {
      provider: providerName,
      strategy: 'manual',
      steps: [
        { kind: 'info', description: `Unknown provider "${providerName}" — manual install required` },
      ],
    };
  }

  const harnessRoot = opts.harnessRoot ?? '~/.claude/skills/harness';
  const claudeRoot = opts.claudeRoot ?? '~/.claude';

  const strategy: InstallStrategy =
    opts.preferStrategy && (def.strategies as readonly string[]).includes(opts.preferStrategy)
      ? opts.preferStrategy
      : def.primaryStrategy;

  if (strategy === 'clone') return clonePlan(def, harnessRoot, claudeRoot);
  if (strategy === 'npx') return npxPlan(def);
  if (strategy === 'npm-global') return npmGlobalPlan(def);

  return {
    provider: providerName,
    strategy: strategy as 'manual',
    steps: [
      { kind: 'info', description: `Install ${def.displayName} manually` },
    ],
  };
}
