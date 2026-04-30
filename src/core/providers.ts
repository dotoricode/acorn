import { type CapabilityName } from './lock.ts';
import {
  loadProviders as loaderLoad,
  type ProviderDef,
  type LoadedProvider,
  type ProviderSource,
  type CapabilityProvision,
  type CapabilityStrength,
  type InstallStrategy,
  type ProviderLoadResult,
} from './provider-loader.ts';

// 외부에서도 사용하는 타입은 그대로 재-export 한다 (downstream import 호환).
export type {
  ProviderDef,
  CapabilityProvision,
  CapabilityStrength,
  InstallStrategy,
  LoadedProvider,
  ProviderSource,
};

const BUILTIN_PROVIDERS: readonly ProviderDef[] = [
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

export function builtinProviders(): readonly ProviderDef[] {
  return BUILTIN_PROVIDERS;
}

/**
 * v0.9.5+: 모듈 레벨 캐시. 첫 호출 시 디스크 + env 병합. 이후 디스크/env 변경
 * 은 `clearProviderCache()` 호출 전까지 반영되지 않는다 (테스트/장기 실행
 * 데몬 외에는 한 프로세스 내에서 안정적인 단일 뷰를 보장).
 */
let cache: ProviderLoadResult | null = null;

function ensureLoaded(): ProviderLoadResult {
  if (cache !== null) return cache;
  cache = loaderLoad({ builtins: BUILTIN_PROVIDERS });
  return cache;
}

export function clearProviderCache(): void {
  cache = null;
}

export function listProviders(): readonly ProviderDef[] {
  return ensureLoaded().providers.map((p) => p.def);
}

export function listLoadedProviders(): readonly LoadedProvider[] {
  return ensureLoaded().providers;
}

export function listProviderWarnings(): readonly string[] {
  return ensureLoaded().warnings;
}

export function getProvider(name: string): ProviderDef | undefined {
  return ensureLoaded().providers.find((p) => p.def.name === name)?.def;
}

export function getLoadedProvider(name: string): LoadedProvider | undefined {
  return ensureLoaded().providers.find((p) => p.def.name === name);
}

export function getProviderSource(name: string): ProviderSource | undefined {
  return getLoadedProvider(name)?.source;
}

export function isCustomProvider(name: string): boolean {
  const src = getProviderSource(name);
  return src === 'env' || src === 'user-file';
}

export function findProvidersByCapability(
  capability: CapabilityName,
  minStrength?: CapabilityStrength,
): readonly ProviderDef[] {
  const strengthOrder: Record<CapabilityStrength, number> = { primary: 3, secondary: 2, partial: 1 };
  const threshold = minStrength ? strengthOrder[minStrength] : 0;
  return listProviders().filter((p) =>
    p.capabilities.some(
      (c) => c.name === capability && strengthOrder[c.strength] >= threshold,
    ),
  );
}
