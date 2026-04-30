import {
  TOOL_NAMES,
  OPTIONAL_TOOL_NAMES,
  type HarnessLock,
  type HarnessLockV3,
  type ProviderEntry,
  type CapabilityName,
  type CapabilityConfig,
  type ToolEntry,
  type ToolName,
  type OptionalToolName,
} from './lock.ts';
import { getProvider } from './providers.ts';
import { AcornError } from './errors.ts';

/**
 * v0.9.6+: v2 → v3 lock migration.
 *
 * 매핑 규칙:
 * - **유지(=v3 provider 로 매핑)**: `gstack` (required), `superpowers` (optional).
 *   v2 의 commit/repo/verified_at 그대로 복사. capability 는 builtin provider 정의의
 *   primary capability 만 활성화한다 (secondary 는 사용자가 필요시 추가).
 * - **삭제(=v3 에서 제거)**: `omc`, `ecc` (legacy 플러그인 레이어), `claude-mem`
 *   (memory provider 미안정). drops 에 기록되고 warning 1 줄씩 추가된다 — 사용자가
 *   수동 정리하도록 안내.
 * - **guard**: mode/patterns 1:1 보존.
 * - **presets**: 미생성 (v2 사용자는 phase.txt 로 단계 관리했고 v3 preset 은
 *   별도 결정 영역. acorn preset <name> 으로 나중에 셋업).
 *
 * 결과는 *순수* — 디스크 변경 없음. caller (commands/migrate.ts) 가 backup +
 * atomic write 를 책임진다.
 */

export type MigrateErrorCode = 'NOT_V2' | 'IO' | 'SCHEMA';

export class MigrateError extends AcornError<MigrateErrorCode> {
  constructor(
    message: string,
    code: MigrateErrorCode,
    hint?: string,
    docsUrl?: string,
  ) {
    super(message, { namespace: 'migrate', code, hint, docsUrl });
    this.name = 'MigrateError';
  }
}

/** v2 tool name → v3 provider 매핑. omc/ecc/claude-mem 은 의도적으로 빠짐. */
const PRESERVED_TOOLS = ['gstack', 'superpowers'] as const;
type PreservedTool = (typeof PRESERVED_TOOLS)[number];

const DROPPED_TOOLS = ['omc', 'ecc', 'claude-mem'] as const;
type DroppedTool = (typeof DROPPED_TOOLS)[number];

const DROP_REASON: Readonly<Record<DroppedTool, string>> = {
  omc: 'OMC 는 v3 에서 plugin-marketplace 모델로 옮겨갔고 acorn 이 직접 관리하지 않습니다. ' +
    '필요하면 Claude Code 세션에서 `/plugin install ...` 으로 직접 설치하세요.',
  ecc: 'ECC 는 v3 provider 가 없습니다 (vendors/ecc 는 수동 관리). ' +
    'acorn install 후 vendors/ecc 디렉토리를 직접 삭제하거나 별도 워크플로우로 옮기세요.',
  'claude-mem': 'memory capability 의 안정 provider 가 없습니다 (experimental). ' +
    'v0.9.x 동안 미운영 슬롯으로 유지됩니다.',
};

export interface MigrationDrop {
  readonly tool: string;
  readonly reason: string;
  readonly hadEntry: boolean;
}

export interface MigrationPreserve {
  readonly tool: PreservedTool;
  readonly entry: ToolEntry;
  readonly capabilities: readonly CapabilityName[];
}

export interface MigrationResult {
  readonly v3Lock: HarnessLockV3;
  readonly preserved: readonly MigrationPreserve[];
  readonly drops: readonly MigrationDrop[];
  readonly warnings: readonly string[];
}

export interface MigrateOptions {
  /** v3Lock.acorn_version 에 박을 값. 기본은 v2 의 acorn_version 그대로. */
  readonly acornVersion?: string;
}

function isPreservedTool(name: string): name is PreservedTool {
  return (PRESERVED_TOOLS as readonly string[]).includes(name);
}

function getPrimaryCapabilities(providerName: string): readonly CapabilityName[] {
  const def = getProvider(providerName);
  if (!def) return [];
  return def.capabilities
    .filter((c) => c.strength === 'primary')
    .map((c) => c.name);
}

function entryToProvider(entry: ToolEntry): ProviderEntry {
  return {
    install_strategy: 'git-clone',
    repo: entry.repo,
    commit: entry.commit,
    verified_at: entry.verified_at,
  };
}

/**
 * Pure migrator. 디스크 변경 없음. 출력은 caller 가 검토 후 commit.
 */
export function migrateV2toV3(v2: HarnessLock, opts: MigrateOptions = {}): MigrationResult {
  const preserved: MigrationPreserve[] = [];
  const drops: MigrationDrop[] = [];
  const warnings: string[] = [];

  // v3 capability 별 provider 후보 모음. 같은 capability 에 여러 provider 가
  // primary 면 모두 등록한다 (v3 capabilities[cap].providers = string[]).
  const capabilityToProviders = new Map<CapabilityName, string[]>();
  const v3Providers: Record<string, ProviderEntry> = {};

  // 1. required tools (omc / gstack / ecc)
  for (const tool of TOOL_NAMES) {
    const entry: ToolEntry = v2.tools[tool];
    if (isPreservedTool(tool)) {
      const caps = getPrimaryCapabilities(tool);
      v3Providers[tool] = entryToProvider(entry);
      preserved.push({ tool, entry, capabilities: caps });
      for (const c of caps) {
        const list = capabilityToProviders.get(c) ?? [];
        list.push(tool);
        capabilityToProviders.set(c, list);
      }
    } else {
      // omc / ecc — drop
      const reason = DROP_REASON[tool as DroppedTool];
      drops.push({ tool, reason, hadEntry: true });
      warnings.push(`drop "${tool}": ${reason}`);
    }
  }

  // 2. optional tools (superpowers / claude-mem)
  for (const tool of OPTIONAL_TOOL_NAMES) {
    const entry = v2.optional_tools[tool];
    if (entry === undefined) continue;
    if (isPreservedTool(tool)) {
      const caps = getPrimaryCapabilities(tool);
      v3Providers[tool] = entryToProvider(entry);
      preserved.push({ tool: tool as PreservedTool, entry, capabilities: caps });
      for (const c of caps) {
        const list = capabilityToProviders.get(c) ?? [];
        list.push(tool);
        capabilityToProviders.set(c, list);
      }
    } else {
      const reason = DROP_REASON[tool as DroppedTool];
      drops.push({ tool, reason, hadEntry: true });
      warnings.push(`drop "${tool}": ${reason}`);
    }
  }

  // 3. v3 capabilities 객체 — Partial<Record<CapabilityName, CapabilityConfig>>.
  //    primary capability 가 없는 (gstack 의 hooks/memory 같은) 슬롯은 비우지 말고
  //    빈 배열로 두지 않는다 — undefined (= absent) 가 v3 의 정상 신호.
  const capabilities: Partial<Record<CapabilityName, CapabilityConfig>> = {};
  for (const [cap, providers] of capabilityToProviders) {
    capabilities[cap] = { providers: [...new Set(providers)] };
  }
  if (Object.keys(capabilities).length === 0) {
    warnings.push(
      'v2 lock 의 어떤 tool 도 v3 provider 로 매핑되지 않아 capabilities 가 비었습니다. ' +
        'acorn preset <starter|builder> --yes 로 기본 capability 셋업이 필요합니다.',
    );
  }

  const v3Lock: HarnessLockV3 = {
    schema_version: 3,
    acorn_version: opts.acornVersion ?? v2.acorn_version,
    capabilities,
    providers: v3Providers,
    guard: v2.guard,
  };

  return { v3Lock, preserved, drops, warnings };
}

// ── plan rendering (CLI 출력용) ──────────────────────────────────────────────

export function renderMigrationPlan(r: MigrationResult): string {
  const lines: string[] = [];
  lines.push('[migrate plan v2 → v3]');
  if (r.preserved.length === 0) {
    lines.push('  (preserved: 없음)');
  } else {
    lines.push('  preserved:');
    for (const p of r.preserved) {
      const caps = p.capabilities.length > 0 ? p.capabilities.join(', ') : '(없음)';
      lines.push(
        `    ${p.tool.padEnd(12)} → git-clone ${p.entry.repo}@${p.entry.commit.slice(0, 7)} ` +
          `→ capabilities: ${caps}`,
      );
    }
  }
  if (r.drops.length > 0) {
    lines.push('  dropped:');
    for (const d of r.drops) lines.push(`    ${d.tool.padEnd(12)} (${d.reason})`);
  }
  lines.push(
    `  guard: ${r.v3Lock.guard.mode}/${r.v3Lock.guard.patterns} (보존)`,
  );
  if (r.warnings.length > 0) {
    lines.push('  warnings:');
    for (const w of r.warnings) lines.push(`    ⚠️  ${w}`);
  }
  return lines.join('\n');
}
