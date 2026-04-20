import { readLock, TOOL_NAMES, type ToolName, type GuardConfig } from '../core/lock.ts';
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
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { lastInProgress, type TxEvent } from '../core/tx.ts';
import { shortSha, distinguishingPair } from '../core/sha-display.ts';

export type VendorState = 'locked' | 'drift' | 'missing' | 'error';

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

export interface StatusReport {
  readonly acornVersion: string;
  readonly harnessRoot: string;
  readonly tools: Readonly<Record<ToolName, ToolStatus>>;
  readonly phase: PhaseStatusField;
  readonly guard: GuardConfig;
  readonly env: readonly EnvDiffEntry[];
  /**
   * §15 M3: settings.json 과 별개로 process.env (Claude Code 세션 런타임) 와
   * 비교한 결과. settings 가 정확해도 세션이 reload 안 했으면 이쪽이 mismatch.
   * 테스트 등 주입된 env 로 계산. CollectOptions.runtimeEnv 미지정 시 process.env 사용.
   */
  /**
   * §15 v0.4.1 #5: `runtimeEnv` 미지정 시 빈 배열 (runtime 체크 skip 의미) —
   * 이전엔 `diffEnv(desired, desired)` self-compare 로 "모두 match" 거짓 반환.
   */
  readonly envRuntime: readonly EnvDiffEntry[];
  readonly gstackSymlink: SymlinkInspection;
  readonly pendingTx: TxEvent | null;
}

export interface CollectOptions {
  readonly lockPath?: string;
  readonly harnessRoot?: string;
  readonly claudeRoot?: string;
  readonly settingsPath?: string;
  readonly claudeMdPath?: string;
  readonly git?: GitRunner;
  /**
   * §15 M3: Claude Code 세션 runtime env. 미지정 시 runtime check 를 skip
   * (envRuntime=[]) — 라이브러리 호출자에겐 "요청 안 함" 의미.
   * CLI (index.ts) 는 process.env 명시 주입. v0.4.1 #5 에서 self-compare 제거.
   */
  readonly runtimeEnv?: Readonly<Record<string, string | undefined>>;
}

export function collectStatus(opts: CollectOptions = {}): StatusReport {
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();
  const claudeRoot = opts.claudeRoot ?? defaultClaudeRoot();
  const settingsPath = opts.settingsPath ?? defaultSettingsPath();
  const claudeMdPath = opts.claudeMdPath ?? defaultClaudeMdPath(claudeRoot);
  const git = opts.git ?? defaultGitRunner;

  const lock = readLock(opts.lockPath);
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

  const desired = computeEnv(harnessRoot);
  const current = readSettings(settingsPath);
  const currentEnv =
    typeof current['env'] === 'object' && current['env'] !== null && !Array.isArray(current['env'])
      ? (current['env'] as Record<string, string | undefined>)
      : {};
  const envDiff = diffEnv(desired, currentEnv);
  // §15 M3 / v0.4.1 #5: 세션 runtime env 와도 비교.
  // runtimeEnv 미지정 = "runtime 체크 요청 안 함" → 빈 배열 반환.
  // 이전 (v0.4.0 까지) 은 `diffEnv(desired, desired)` self-compare 로 "모두 match"
  // 를 거짓 반환해 라이브러리 호출자가 실제 세션 상태를 확인한 줄 착각할 수 있었다.
  // CLI 경로는 index.ts 에서 `runtimeEnv: process.env` 명시 전달하므로 영향 없음.
  const envRuntimeDiff: readonly EnvDiffEntry[] = opts.runtimeEnv
    ? diffEnv(desired, opts.runtimeEnv)
    : [];

  const phaseRead = readPhase(harnessRoot);
  const claudeMdPhase = readPhaseFromClaudeMd(claudeMdPath);
  const claudeMdSt = claudeMdMarkerStatus(claudeMdPath, phaseRead.value);
  const phaseField: PhaseStatusField = {
    value: phaseRead.value,
    path: phaseRead.path,
    status: phaseRead.status,
    claudeMdValue: claudeMdPhase,
    claudeMdStatus: claudeMdSt,
  };

  return {
    acornVersion: lock.acorn_version,
    harnessRoot,
    tools,
    phase: phaseField,
    guard: lock.guard,
    env: envDiff,
    envRuntime: envRuntimeDiff,
    gstackSymlink: inspectGstackSymlink({ harnessRoot, claudeRoot }),
    pendingTx: lastInProgress(harnessRoot),
  };
}

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
  }
}

function stateLabel(s: ToolStatus): string {
  switch (s.state) {
    case 'locked':
      return 'locked';
    case 'drift': {
      // §15 v0.2.0 S2: 7-char short SHA 로는 "끝만 다른" drift 가 같아 보여 혼란.
      // 차이 나는 위치까지 확장해서 두 SHA 를 나란히 보여준다.
      const [lockDisp, actualDisp] = distinguishingPair(s.lockCommit, s.actualCommit);
      return `drift (lock=${lockDisp} 실제=${actualDisp})`;
    }
    case 'missing':
      return 'missing';
    case 'error':
      return 'error';
  }
}

function envIcon(status: EnvDiffEntry['status']): string {
  return status === 'match' ? '✅' : status === 'missing' ? '❌' : '⚠️';
}

export function renderStatus(r: StatusReport): string {
  const lines: string[] = [];
  lines.push(`acorn v${r.acornVersion}  •  ${r.harnessRoot}`);
  lines.push('─'.repeat(60));
  for (const name of TOOL_NAMES) {
    const t = r.tools[name];
    const suffix = name === 'gstack' ? '  (symlinked)' : '';
    lines.push(
      `  ${name.padEnd(7)} ${shortSha(t.lockCommit)}  ${stateIcon(t.state)}  ${stateLabel(t)}${suffix}`,
    );
  }
  lines.push('─'.repeat(60));
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

export interface StatusSummary {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

export function summarize(r: StatusReport): StatusSummary {
  const issues: string[] = [];
  for (const name of TOOL_NAMES) {
    const t = r.tools[name];
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
  return { ok: issues.length === 0, issues };
}
