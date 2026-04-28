import { readLock, TOOL_NAMES, type HarnessLock, type HarnessLockV3, type AnyHarnessLock, type ToolName, type GuardConfig, type CapabilityName } from '../core/lock.ts';
import {
  computeEnv,
  defaultClaudeRoot,
  defaultHarnessRoot,
  diffEnv,
  vendorsRoot,
  type EnvDiffEntry,
} from '../core/env.ts';
import { readPhase, type Phase, type PhaseStatus } from '../core/phase.ts';
import { defaultClaudeMdPath, claudeMdMarkerStatus, readPhaseFromClaudeMd } from '../core/claude-md.ts';
import {
  defaultSettingsPath,
  readSettings,
} from '../core/settings.ts';
import {
  inspectGstackSymlink,
  type SymlinkInspection,
} from '../core/symlink.ts';
import {
  defaultGitRunner,
  readCurrentCommit,
  type GitRunner,
} from '../core/vendors.ts';
import { readPreset, type PresetRead } from '../core/preset.ts';
import { detectProvider, defaultDetectEnv, type DetectEnv } from '../core/provider-detect.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { lastInProgress, type TxEvent } from '../core/tx.ts';
import { shortSha, distinguishingPair } from '../core/sha-display.ts';

export type VendorState = 'locked' | 'drift' | 'missing' | 'error' | 'not_applicable';

export interface PhaseStatusField {
  readonly value: Phase | null;
  readonly path: string;
  readonly status: PhaseStatus;
  readonly claudeMdValue: Phase | null;
  readonly claudeMdStatus: 'ok' | 'missing' | 'mismatch' | 'corrupt';
}

export interface ToolStatus {
  readonly tool: ToolName;
  readonly repo: string;
  readonly lockCommit: string;
  readonly actualCommit: string | null;
  readonly state: VendorState;
  readonly error?: string;
}

// ── v3 status types ───────────────────────────────────────────────────────────

export interface CapabilityProviderStatus {
  readonly provider: string;
  readonly state: 'installed' | 'missing' | 'unknown';
  readonly detail?: string;
}

export interface CapabilityStatusEntry {
  readonly capability: CapabilityName;
  readonly configuredProviders: readonly string[];
  readonly providerStates: readonly CapabilityProviderStatus[];
  readonly anyInstalled: boolean;
}

export interface V3ProviderLockEntry {
  readonly provider: string;
  readonly installStrategy: string;
  readonly commit?: string;
  /** v0.9.3+: npm/npx provider 의 lock semver (선택). doctor 가 npm 비교용. */
  readonly version?: string;
  /** v0.9.3+: npm/npx provider 의 install 명령 — npm 패키지 추출용. */
  readonly installCmd?: string;
}

export interface V3StatusSection {
  readonly preset: PresetRead;
  readonly capabilities: readonly CapabilityStatusEntry[];
  readonly lockProviders: readonly V3ProviderLockEntry[];
}

// ── StatusReport ──────────────────────────────────────────────────────────────

export interface StatusReport {
  readonly acornVersion: string;
  readonly harnessRoot: string;
  readonly tools: Readonly<Record<ToolName, ToolStatus>>;
  readonly phase: PhaseStatusField;
  readonly guard: GuardConfig;
  readonly env: readonly EnvDiffEntry[];
  /**
   * §15 v0.4.1 #5: `runtimeEnv` 미지정 시 빈 배열 (runtime 체크 skip 의미).
   */
  readonly envRuntime: readonly EnvDiffEntry[];
  readonly gstackSymlink: SymlinkInspection;
  readonly pendingTx: TxEvent | null;
  readonly v3?: V3StatusSection;
}

export interface CollectOptions {
  readonly lockPath?: string;
  readonly harnessRoot?: string;
  readonly claudeRoot?: string;
  readonly settingsPath?: string;
  readonly claudeMdPath?: string;
  readonly git?: GitRunner;
  /**
   * §15 M3: Claude Code 세션 runtime env. 미지정 시 runtime check skip.
   */
  readonly runtimeEnv?: Readonly<Record<string, string | undefined>>;
  /** 테스트 주입용 detect environment (v3 provider 감지) */
  readonly detectEnv?: DetectEnv;
}

// ── helper: build placeholder tools for v3 locks ─────────────────────────────

function notApplicableTools(): Record<ToolName, ToolStatus> {
  const tools = {} as Record<ToolName, ToolStatus>;
  for (const name of TOOL_NAMES) {
    tools[name] = {
      tool: name,
      repo: '',
      lockCommit: '',
      actualCommit: null,
      state: 'not_applicable',
    };
  }
  return tools;
}

// ── helper: build shared phase field ─────────────────────────────────────────

function buildPhaseField(
  harnessRoot: string,
  claudeMdPath: string,
): PhaseStatusField {
  const phaseRead = readPhase(harnessRoot);
  const claudeMdPhase = readPhaseFromClaudeMd(claudeMdPath);
  const claudeMdSt = claudeMdMarkerStatus(claudeMdPath, phaseRead.value);
  return {
    value: phaseRead.value,
    path: phaseRead.path,
    status: phaseRead.status,
    claudeMdValue: claudeMdPhase,
    claudeMdStatus: claudeMdSt,
  };
}

// ── helper: build v3 section ──────────────────────────────────────────────────

function buildV3Section(lock3: HarnessLockV3, harnessRoot: string, dEnv: DetectEnv): V3StatusSection {
  const capabilityStatuses: CapabilityStatusEntry[] = [];
  const capKeys = Object.keys(lock3.capabilities) as CapabilityName[];
  for (const cap of capKeys) {
    const capConfig = lock3.capabilities[cap];
    const configuredProviders: string[] = capConfig?.providers ? [...capConfig.providers] : [];
    const providerStates: CapabilityProviderStatus[] = configuredProviders.map((pName) => {
      const result = detectProvider(pName, dEnv);
      if (result.detail !== undefined) {
        return { provider: pName, state: result.state, detail: result.detail };
      }
      return { provider: pName, state: result.state };
    });
    capabilityStatuses.push({
      capability: cap,
      configuredProviders,
      providerStates,
      anyInstalled: providerStates.some((p) => p.state === 'installed'),
    });
  }

  const lockProviders: V3ProviderLockEntry[] = Object.entries(lock3.providers).map(([name, entry]) => {
    if (entry.install_strategy === 'git-clone') {
      return { provider: name, installStrategy: entry.install_strategy, commit: entry.commit };
    }
    if (entry.install_strategy === 'plugin-marketplace') {
      return { provider: name, installStrategy: entry.install_strategy };
    }
    // npm | npx
    return {
      provider: name,
      installStrategy: entry.install_strategy,
      installCmd: entry.install_cmd,
      ...(entry.version !== undefined ? { version: entry.version } : {}),
    };
  });

  const preset = readPreset(harnessRoot);
  return { preset, capabilities: capabilityStatuses, lockProviders };
}

// ── collectStatus ─────────────────────────────────────────────────────────────

export function collectStatus(opts: CollectOptions = {}): StatusReport {
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();
  const claudeRoot = opts.claudeRoot ?? defaultClaudeRoot();
  const settingsPath = opts.settingsPath ?? defaultSettingsPath();
  const claudeMdPath = opts.claudeMdPath ?? defaultClaudeMdPath(claudeRoot);
  const git = opts.git ?? defaultGitRunner;

  const anyLock: AnyHarnessLock = readLock(opts.lockPath);

  const desired = computeEnv(harnessRoot);
  const current = readSettings(settingsPath);
  const currentEnv =
    typeof current['env'] === 'object' && current['env'] !== null && !Array.isArray(current['env'])
      ? (current['env'] as Record<string, string | undefined>)
      : {};
  const envDiff = diffEnv(desired, currentEnv);
  const envRuntimeDiff: readonly EnvDiffEntry[] = opts.runtimeEnv
    ? diffEnv(desired, opts.runtimeEnv)
    : [];

  const phaseField = buildPhaseField(harnessRoot, claudeMdPath);
  const gstackSymlink = inspectGstackSymlink({ harnessRoot, claudeRoot });
  const pendingTx = lastInProgress(harnessRoot);

  // ── v3 path ───────────────────────────────────────────────────────────────
  if (anyLock.schema_version === 3) {
    const lock3 = anyLock as HarnessLockV3;
    const dEnv = opts.detectEnv ?? defaultDetectEnv(harnessRoot);
    const v3 = buildV3Section(lock3, harnessRoot, dEnv);
    return {
      acornVersion: lock3.acorn_version,
      harnessRoot,
      tools: notApplicableTools(),
      phase: phaseField,
      guard: lock3.guard,
      env: envDiff,
      envRuntime: envRuntimeDiff,
      gstackSymlink,
      pendingTx,
      v3,
    };
  }

  // ── v2 path (original logic) ──────────────────────────────────────────────
  const lock = anyLock as HarnessLock;
  const vRoot = vendorsRoot(harnessRoot);

  const tools: Record<ToolName, ToolStatus> = {} as Record<ToolName, ToolStatus>;
  for (const name of TOOL_NAMES) {
    const entry = lock.tools[name];
    const path = join(vRoot, name);
    if (!existsSync(path)) {
      tools[name] = {
        tool: name,
        repo: entry.repo,
        lockCommit: entry.commit,
        actualCommit: null,
        state: 'missing',
      };
      continue;
    }
    try {
      const actual = readCurrentCommit(path, git);
      tools[name] = {
        tool: name,
        repo: entry.repo,
        lockCommit: entry.commit,
        actualCommit: actual,
        state: actual === entry.commit ? 'locked' : 'drift',
      };
    } catch (e) {
      tools[name] = {
        tool: name,
        repo: entry.repo,
        lockCommit: entry.commit,
        actualCommit: null,
        state: 'error',
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return {
    acornVersion: lock.acorn_version,
    harnessRoot,
    tools,
    phase: phaseField,
    guard: lock.guard,
    env: envDiff,
    envRuntime: envRuntimeDiff,
    gstackSymlink,
    pendingTx,
  };
}

// ── render helpers ────────────────────────────────────────────────────────────

function stateIcon(state: VendorState): string {
  switch (state) {
    case 'locked':
      return '✅';
    case 'drift':
      return '⚠️';
    case 'missing':
      return '❌';
    case 'error':
      return '⛔';
    case 'not_applicable':
      return '—';
  }
}

function stateLabel(s: ToolStatus): string {
  switch (s.state) {
    case 'locked':
      return 'locked';
    case 'drift': {
      const [lockDisp, actualDisp] = distinguishingPair(s.lockCommit, s.actualCommit);
      return `drift (lock=${lockDisp} 실제=${actualDisp})`;
    }
    case 'missing':
      return 'missing';
    case 'error':
      return 'error';
    case 'not_applicable':
      return 'n/a';
  }
}

function envIcon(status: EnvDiffEntry['status']): string {
  return status === 'match' ? '✅' : status === 'missing' ? '❌' : '⚠️';
}

function capProviderIcon(state: 'installed' | 'missing' | 'unknown'): string {
  return state === 'installed' ? '●' : state === 'missing' ? '○' : '?';
}

// ── renderStatus ──────────────────────────────────────────────────────────────

export function renderStatus(r: StatusReport): string {
  const lines: string[] = [];
  lines.push(`acorn v${r.acornVersion}  •  ${r.harnessRoot}`);
  lines.push('─'.repeat(60));

  // v2 tools section (skip for v3 locks)
  const hasV2Tools = Object.values(r.tools).some((t) => t.state !== 'not_applicable');
  if (hasV2Tools) {
    for (const name of TOOL_NAMES) {
      const t = r.tools[name];
      if (t.state === 'not_applicable') continue;
      const suffix = name === 'gstack' ? '  (symlinked)' : '';
      lines.push(
        `  ${name.padEnd(7)} ${shortSha(t.lockCommit)}  ${stateIcon(t.state)}  ${stateLabel(t)}${suffix}`,
      );
    }
    lines.push('─'.repeat(60));
  }

  // v3 preset + capabilities section
  if (r.v3) {
    const { preset, capabilities } = r.v3;
    const presetVal = preset.value ?? '(미설정)';
    const legacyNote = preset.legacy ? '  [legacy phase.txt]' : '';
    const presetIcon = preset.status === 'ok' ? '✅' : preset.status === 'missing' ? '❌' : '⚠️';
    lines.push(`  preset   ${presetVal}${legacyNote}  ${presetIcon}`);

    if (capabilities.length > 0) {
      lines.push('  capabilities:');
      for (const cap of capabilities) {
        const allMissing = cap.configuredProviders.length > 0 && !cap.anyInstalled;
        const capIcon = cap.configuredProviders.length === 0 ? '⚠️' : allMissing ? '❌' : '✅';
        const providerStr = cap.providerStates
          .map((p) => `${capProviderIcon(p.state)} ${p.provider}`)
          .join('  ');
        const noProvider = cap.configuredProviders.length === 0 ? '(제공자 미설정)' : '';
        lines.push(`    ${capIcon} ${cap.capability.padEnd(14)} ${providerStr}${noProvider}`);
      }
    } else {
      lines.push('  capabilities: (없음)');
    }
    lines.push('─'.repeat(60));
  }

  {
    const p = r.phase;
    const phaseVal = p.value ?? (p.status === 'missing' ? '(미설정)' : '(잘못된값)');
    const icon =
      p.status === 'ok' && p.claudeMdStatus === 'ok'
        ? '✅'
        : p.status === 'missing'
          ? '❌'
          : '⚠️';
    const note =
      p.claudeMdStatus === 'mismatch'
        ? '  ⚠️ CLAUDE.md 와 불일치 — acorn install 로 동기화'
        : p.claudeMdStatus === 'corrupt'
          ? '  ⚠️ CLAUDE.md 마커 손상'
          : p.claudeMdStatus === 'missing'
            ? '  (CLAUDE.md 마커 없음)'
            : '';
    lines.push(`  phase    ${phaseVal.padEnd(12)} ${icon}${note}`);
  }
  lines.push(`  guard    ${r.guard.mode} / ${r.guard.patterns}`);
  lines.push('  env:');
  for (const e of r.env) {
    lines.push(`    ${e.key.padEnd(20)} ${envIcon(e.status)}  ${e.status}`);
  }
  const gs = r.gstackSymlink;
  lines.push(
    `  gstack link   ${gs.status === 'correct' ? '✅' : '⚠️'}  ${gs.status}`,
  );
  if (r.pendingTx) {
    lines.push('─'.repeat(60));
    lines.push(
      `  ⛔ 이전 설치 미완료: phase=${r.pendingTx.phase ?? 'begin'} ts=${r.pendingTx.ts}`,
    );
  }
  return lines.join('\n');
}

export function renderStatusJson(r: StatusReport): string {
  return JSON.stringify(r, null, 2);
}

// ── summarize ─────────────────────────────────────────────────────────────────

export interface StatusSummary {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

export function summarize(r: StatusReport): StatusSummary {
  const issues: string[] = [];

  // v2 tool issues (skip not_applicable)
  for (const name of TOOL_NAMES) {
    const t = r.tools[name];
    if (t.state === 'not_applicable') continue;
    if (t.state !== 'locked') issues.push(`${name}: ${t.state}`);
  }

  for (const e of r.env) {
    if (e.status !== 'match') issues.push(`env.${e.key}: ${e.status}`);
  }
  if (r.phase.status !== 'ok') issues.push(`phase: ${r.phase.status}`);
  if (r.phase.claudeMdStatus === 'mismatch') issues.push(`claude-md: mismatch`);
  if (r.phase.claudeMdStatus === 'corrupt') issues.push(`claude-md: corrupt`);
  if (r.gstackSymlink.status !== 'correct') {
    issues.push(`gstack-symlink: ${r.gstackSymlink.status}`);
  }
  if (r.pendingTx) issues.push(`tx.in_progress: ${r.pendingTx.phase ?? 'begin'}`);

  // v3 capability issues
  if (r.v3) {
    for (const cap of r.v3.capabilities) {
      if (cap.configuredProviders.length === 0) {
        issues.push(`capability.${cap.capability}: no providers configured`);
      } else if (!cap.anyInstalled) {
        issues.push(`capability.${cap.capability}: no provider installed`);
      }
    }
  }

  return { ok: issues.length === 0, issues };
}
