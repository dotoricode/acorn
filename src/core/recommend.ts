import { type CapabilityName } from './lock.ts';
import { findProvidersByCapability } from './providers.ts';
import { type ProjectProfile } from './project-profile.ts';

export type RecommendationPriority = 'required' | 'recommended' | 'optional';

export interface CapabilityRecommendation {
  readonly capability: CapabilityName;
  readonly providers: readonly string[];
  readonly priority: RecommendationPriority;
  readonly reason: string;
  /** v0.9.2+: experimental capability 는 기본 disabled 권장 (예: memory). */
  readonly experimental?: boolean;
}

export interface RecommendationResult {
  readonly capabilities: readonly CapabilityRecommendation[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function providersFor(capability: CapabilityName): readonly string[] {
  return findProvidersByCapability(capability, 'secondary').map((p) => p.name);
}

function rec(
  capability: CapabilityName,
  priority: RecommendationPriority,
  reason: string,
): CapabilityRecommendation {
  return { capability, providers: providersFor(capability), priority, reason };
}

// ── recommendation engine ─────────────────────────────────────────────────────

export function recommend(profile: ProjectProfile): RecommendationResult {
  const caps: CapabilityRecommendation[] = [];

  // planning — always
  caps.push(rec(
    'planning',
    'recommended',
    'Structured planning reduces wasted iterations on any project.',
  ));

  // spec — backend or workers
  if (profile.hasBackend || profile.hasWorkers) {
    caps.push(rec(
      'spec',
      'recommended',
      'APIs and background systems benefit from explicit spec docs before implementation.',
    ));
  }

  // tdd — always; required when test maturity is low or absent
  const tddLow = profile.testMaturity === 'none' || profile.testMaturity === 'low';
  caps.push(rec(
    'tdd',
    tddLow ? 'required' : 'recommended',
    profile.testMaturity === 'none'
      ? 'No tests detected — TDD is the highest-ROI change available right now.'
      : profile.testMaturity === 'low'
        ? 'Sparse test coverage — TDD prevents regressions as the codebase grows.'
        : 'TDD keeps shipping velocity high as features accumulate.',
  ));

  // review — always
  caps.push(rec(
    'review',
    'recommended',
    'Automated review catches bugs and style drift before they reach the main branch.',
  ));

  // qa_ui — UI only
  if (profile.hasUi) {
    caps.push(rec(
      'qa_ui',
      'recommended',
      'UI detected — visual/interaction testing catches regressions that unit tests miss.',
    ));
  }

  // qa_headless — backend or workers; may have no provider (special rule)
  if (profile.hasBackend || profile.hasWorkers) {
    const headlessProviders = providersFor('qa_headless');
    caps.push({
      capability: 'qa_headless',
      providers: headlessProviders,
      priority: 'recommended',
      reason:
        headlessProviders.length > 0
          ? 'Backend/worker layer benefits from headless integration tests.'
          : 'Backend/worker layer benefits from headless integration tests. No dedicated provider yet — use your test runner directly.',
    });
  }

  // hooks — always required
  caps.push(rec(
    'hooks',
    'required',
    'Hooks automate quality gates (guard, type-check, lint) on every Claude tool call.',
  ));

  // memory — v0.9.2+ plan §11 정책: 항상 노출하되 experimental 로 기본 disabled 권고.
  // workers / fullstack 같은 강한 시그널이 있을 때만 reason 을 "고려해볼 만함" 톤으로,
  // 그 외엔 "끄는 쪽이 안전" 톤. provider 가 안정화될 때까지 사용자 환경 오염 방지.
  const memorySignal = profile.hasWorkers || (profile.hasBackend && profile.hasUi);
  caps.push({
    capability: 'memory',
    providers: providersFor('memory'),
    priority: 'optional',
    experimental: true,
    reason: memorySignal
      ? '장기 실행 / 멀티 컨텍스트 작업에서 후보. provider 가 experimental 단계라 기본 disabled 권장.'
      : 'experimental capability — 안정 provider 가 등장하기 전까지 disabled 가 기본값.',
  });

  return { capabilities: caps };
}

// ── rendering ─────────────────────────────────────────────────────────────────

export function renderRecommendation(result: RecommendationResult): string {
  const lines: string[] = ['Recommended capabilities:'];
  for (const r of result.capabilities) {
    const provStr = r.providers.length > 0 ? r.providers.join(', ') : 'no provider yet';
    const expTag = r.experimental ? ' (experimental)' : '';
    lines.push(`  [${r.priority.padEnd(11)}] ${r.capability.padEnd(12)}${expTag} → ${provStr}`);
    lines.push(`               ${r.reason}`);
  }
  return lines.join('\n');
}
