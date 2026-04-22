import { type CapabilityName } from './lock.ts';

export type InstallStrategy = 'clone' | 'npx' | 'npm-global' | 'plugin-marketplace' | 'manual';

export type CapabilityStrength = 'primary' | 'secondary' | 'partial';

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
  readonly repo?: string;        // github owner/repo — for clone strategy
  readonly packageName?: string; // npm package — for npx/npm-global strategy
  readonly command?: string;     // CLI binary name — for detection
}

const PROVIDERS: readonly ProviderDef[] = [
  {
    name: 'gstack',
    displayName: 'gstack',
    capabilities: [
      { name: 'hooks', strength: 'primary' },
      { name: 'memory', strength: 'secondary' },
    ],
    strategies: ['clone'],
    primaryStrategy: 'clone',
    repo: 'garrytan/gstack',
  },
  {
    name: 'superpowers',
    displayName: 'Superpowers',
    capabilities: [
      { name: 'planning', strength: 'primary' },
      { name: 'spec', strength: 'secondary' },
      { name: 'review', strength: 'secondary' },
      { name: 'tdd', strength: 'partial' },
    ],
    strategies: ['clone'],
    primaryStrategy: 'clone',
    repo: 'obra/superpowers',
  },
  {
    name: 'gsd',
    displayName: 'Get Shit Done',
    capabilities: [
      { name: 'planning', strength: 'primary' },
      { name: 'qa_headless', strength: 'secondary' },
    ],
    strategies: ['npx', 'clone'],
    primaryStrategy: 'npx',
    repo: 'gsd-build/get-shit-done',
    packageName: 'gsd',
    command: 'gsd',
  },
  {
    name: 'claudekit',
    displayName: 'claudekit',
    capabilities: [
      { name: 'hooks', strength: 'primary' },
      { name: 'review', strength: 'partial' },
      { name: 'tdd', strength: 'partial' },
    ],
    strategies: ['npx', 'npm-global'],
    primaryStrategy: 'npx',
    packageName: '@carlrannaberg/claudekit',
    command: 'claudekit',
  },
];

export function listProviders(): readonly ProviderDef[] {
  return PROVIDERS;
}

export function getProvider(name: string): ProviderDef | undefined {
  return PROVIDERS.find((p) => p.name === name);
}

export function findProvidersByCapability(
  capability: CapabilityName,
  minStrength?: CapabilityStrength,
): readonly ProviderDef[] {
  const strengthOrder: Record<CapabilityStrength, number> = { primary: 3, secondary: 2, partial: 1 };
  const threshold = minStrength ? strengthOrder[minStrength] : 0;
  return PROVIDERS.filter((p) =>
    p.capabilities.some(
      (c) => c.name === capability && strengthOrder[c.strength] >= threshold,
    ),
  );
}
