import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { DoctorIssue } from '../commands/doctor.ts';
import { defaultHarnessRoot } from './env.ts';
import { AcornError } from './errors.ts';

/**
 * v0.9.7+: drift 자동 복구.
 *
 * doctor 가 발견한 issue 를 3-tier 위험도로 분류한다:
 * - **safe**: 멱등 작업 (대부분 `acorn install` 재실행). 자동 OK.
 * - **interactive**: 잠재적 비파괴이나 사용자 결정 가치. Y/n.
 * - **refuse**: 사용자 데이터 / 외부 상태 / 명시적 결정 필요. 수동 가이드.
 *
 * 분류는 `(area, severity, subject, message)` 4-튜플 키워드 매칭. 새 이슈 타입이
 * 생기면 여기 한 곳만 갱신.
 *
 * 실행은 `runRecovery({issues, reinstall})` — `reinstall` 콜백이 주입되어
 * commands/install ↔ commands/doctor 간 순환 import 회피.
 *
 * tx.log 통합: `recovery-classify`, `recovery-execute`, `recovery-failed` phase.
 */

// ── tiers + strategy ─────────────────────────────────────────────────────────

export type RecoveryTier = 'safe' | 'interactive' | 'refuse';

export type RecoveryAction = 'reinstall' | 'noop';

export interface RecoveryStrategy {
  readonly tier: RecoveryTier;
  readonly action: RecoveryAction | null;
  readonly reason: string;
}

const REFUSE = (reason: string): RecoveryStrategy => ({
  tier: 'refuse',
  action: null,
  reason,
});

const SAFE_REINSTALL: RecoveryStrategy = {
  tier: 'safe',
  action: 'reinstall',
  reason: 'acorn install 이 idempotent — 누락 / drift / 심링크 / settings 자동 복원',
};

/**
 * 단일 doctor issue → 복구 전략. 분류만 — 실행은 runRecovery 가 담당.
 */
export function classifyIssue(issue: DoctorIssue): RecoveryStrategy {
  const a = issue.area;
  const m = issue.message;
  const sub = issue.subject;

  // ── refuse 우선 (명시적 사용자 결정/외부 상태) ──────────────────────────
  if (a === 'guard' && sub === 'ACORN_GUARD_BYPASS') {
    return REFUSE(
      'env var는 부모 셸 소유 — acorn 이 unset 불가. 수동: `unset ACORN_GUARD_BYPASS`',
    );
  }
  if (a === 'tx') {
    return REFUSE(
      '미완료 install — tx.log 직접 검토 후 정상이면 `acorn install --force` 결정',
    );
  }
  if (a === 'symlink' && /심링크가 아닌/.test(m)) {
    return REFUSE('사용자 데이터 가능성 — 내용 확인 후 수동 제거');
  }
  if (a === 'phase' && sub === 'CLAUDE.md' && /손상/.test(m)) {
    return REFUSE('CLAUDE.md 마커 손상 — 수동 편집 후 재실행');
  }
  if (a === 'vendor' && /로컬 변경/.test(m)) {
    return REFUSE('vendor dirty — git status 후 commit/stash/discard 사용자 결정');
  }
  if (a === 'vendor' && /dirty 상태 감지 실패/.test(m)) {
    return REFUSE('git status 자체 실패 — 저장소 권한/잠금 수동 검사');
  }
  if (a === 'vendor' && /rev-parse/.test(m)) {
    return REFUSE('저장소 손상 가능 — `git -C <vendor> status` 수동 검사');
  }
  if (a === 'vendor' && /읽기 실패/.test(m)) {
    return REFUSE('디스크 권한 / 파일시스템 — 수동 확인');
  }
  if (a === 'vendor' && issue.severity === 'info' && /npm 버전 drift/.test(m)) {
    return REFUSE('의도적 pinning 가능 — install_cmd 와 lock.version 수동 갱신 결정');
  }
  if (a === 'env' && issue.severity === 'info' && /runtime/.test(m)) {
    return REFUSE(
      'Claude Code 세션 reload 필요 — acorn 이 부모 프로세스 env 수정 불가',
    );
  }
  if (a === 'phase' && sub === 'phase.txt') {
    return REFUSE('phase 값은 사용자 선택 — `acorn phase set <prototype|dev|production>`');
  }
  if (a === 'capability' && /lock 에 제공자가 설정되지 않음/.test(m)) {
    return REFUSE('harness.lock capabilities 섹션 직접 편집 필요');
  }

  // ── safe (acorn install 이 처리) ──────────────────────────────────────
  if (a === 'vendor' && (issue.severity === 'critical' || /SHA 불일치/.test(m))) {
    return SAFE_REINSTALL;
  }
  if (a === 'symlink' && (/부재/.test(m) || /엉뚱한/.test(m))) {
    return SAFE_REINSTALL;
  }
  if (a === 'env' && issue.severity !== 'info') {
    return SAFE_REINSTALL;
  }
  if (a === 'phase' && sub === 'CLAUDE.md' && /불일치/.test(m)) {
    return SAFE_REINSTALL;
  }
  if (a === 'capability' && (/미설치/.test(m) || /일부/.test(m))) {
    return SAFE_REINSTALL;
  }

  // ── default: 미정의 → refuse ──────────────────────────────────────────
  return REFUSE('자동 복구 전략 미정의 — issue.hint 따라 수동 처리');
}

// ── runner ──────────────────────────────────────────────────────────────────

export type RecoveryResult =
  | 'fixed'
  | 'skipped' // interactive 거절
  | 'refused' // 분류상 refuse
  | 'failed'  // safe action 시도했으나 throw
  | 'cancelled'; // 사용자 중단

export interface RecoveryOutcome {
  readonly issue: DoctorIssue;
  readonly strategy: RecoveryStrategy;
  readonly result: RecoveryResult;
  readonly detail?: string;
}

export interface RecoveryReport {
  readonly outcomes: readonly RecoveryOutcome[];
  readonly fixed: number;
  readonly skipped: number;
  readonly refused: number;
  readonly failed: number;
  /** 안 고친 것 (refused + skipped + failed) 합. 0 이면 깔끔 종료. */
  readonly remaining: number;
}

export type ConfirmFn = (prompt: string) => boolean;

export type RecoveryErrorCode = 'IO' | 'NO_REINSTALL';

export class RecoveryError extends AcornError<RecoveryErrorCode> {
  constructor(
    message: string,
    code: RecoveryErrorCode,
    hint?: string,
    docsUrl?: string,
  ) {
    super(message, { namespace: 'recovery', code, hint, docsUrl });
    this.name = 'RecoveryError';
  }
}

export interface RecoveryRunOptions {
  readonly issues: readonly DoctorIssue[];
  readonly harnessRoot?: string;
  /** Y/n 자동 승인 — interactive tier 만 영향. */
  readonly yes?: boolean;
  /** 안전한 것만 실행 — interactive 는 skip 으로 처리. */
  readonly safeOnly?: boolean;
  readonly confirm?: ConfirmFn;
  readonly logger?: (line: string) => void;
  /**
   * 실제 install 호출. recovery → install 순환 import 회피용 콜백.
   * 호출 1 회로 reinstall 액션을 그룹 처리한다.
   */
  readonly reinstall?: () => void;
}

interface Group {
  readonly action: RecoveryAction;
  readonly outcomes: RecoveryOutcome[];
}

export function runRecovery(opts: RecoveryRunOptions): RecoveryReport {
  const log = opts.logger ?? (() => undefined);
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();

  // recovery 는 install 의 tx.log 와 분리된 별도 jsonl 로그에 marker 를 남긴다.
  // tx.log 에 unbalanced phase 이벤트를 쓰면 install 의 lastInProgress 가 IN_PROGRESS
  // 로 차단되므로 같은 파일을 공유하지 않는다. forensic 은 `recovery.jsonl`.
  const recoveryLogPath = join(harnessRoot, 'recovery.jsonl');
  const writeMarker = (phase: string, extra?: Record<string, unknown>): void => {
    try {
      mkdirSync(harnessRoot, { recursive: true });
      const entry = { ts: new Date().toISOString(), phase, ...extra };
      appendFileSync(recoveryLogPath, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // 로그 쓰기 실패는 silent — recovery 본 흐름 막지 않음.
    }
  };

  // 1. classify — fail-soft, 디스크 변경 없음.
  writeMarker('recovery-classify', { issueCount: opts.issues.length });
  const classified: RecoveryOutcome[] = opts.issues.map((issue) => ({
    issue,
    strategy: classifyIssue(issue),
    result: 'refused' as RecoveryResult,
  }));

  // 2. 분기 — refuse 즉시 확정, interactive 는 confirm, safe 는 그룹 실행 큐.
  const finalOutcomes: RecoveryOutcome[] = [];
  const reinstallQueue: RecoveryOutcome[] = [];

  for (const o of classified) {
    if (o.strategy.tier === 'refuse') {
      finalOutcomes.push({ ...o, result: 'refused' });
      continue;
    }
    if (o.strategy.tier === 'interactive') {
      if (opts.safeOnly) {
        finalOutcomes.push({ ...o, result: 'skipped', detail: '--safe-only' });
        continue;
      }
      if (opts.yes) {
        // pending — safe 처럼 처리
      } else if (opts.confirm) {
        const accepted = opts.confirm(`${o.issue.subject}: ${o.strategy.reason} — 진행?`);
        if (!accepted) {
          finalOutcomes.push({ ...o, result: 'skipped', detail: '사용자 거절' });
          continue;
        }
      } else {
        finalOutcomes.push({
          ...o,
          result: 'skipped',
          detail: 'non-TTY 또는 --yes 없음',
        });
        continue;
      }
    }
    if (o.strategy.action === 'reinstall') {
      reinstallQueue.push(o);
    } else if (o.strategy.action === 'noop' || o.strategy.action === null) {
      finalOutcomes.push({ ...o, result: 'fixed', detail: 'no-op' });
    }
  }

  // 3. reinstall 그룹 실행 — 1 회 호출로 큐 전체 cover.
  if (reinstallQueue.length > 0) {
    if (!opts.reinstall) {
      throw new RecoveryError(
        'reinstall 콜백이 주입되지 않았습니다. caller 가 commands/install 의 runInstall 을 전달해야 합니다.',
        'NO_REINSTALL',
      );
    }
    writeMarker('recovery-execute', { queueSize: reinstallQueue.length });
    log(`[recovery] ${reinstallQueue.length} 개 이슈를 acorn install 재실행으로 복구 시도`);
    try {
      opts.reinstall();
      writeMarker('recovery-success', { fixed: reinstallQueue.length });
      for (const o of reinstallQueue) {
        finalOutcomes.push({
          ...o,
          result: 'fixed',
          detail: 'acorn install 재실행',
        });
      }
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      log(`[recovery] install 실패: ${detail}`);
      writeMarker('recovery-failed', { error: detail });
      for (const o of reinstallQueue) {
        finalOutcomes.push({
          ...o,
          result: 'failed',
          detail,
        });
      }
      return summarize(finalOutcomes);
    }
  }

  return summarize(finalOutcomes);
}

function summarize(outcomes: readonly RecoveryOutcome[]): RecoveryReport {
  let fixed = 0,
    skipped = 0,
    refused = 0,
    failed = 0;
  for (const o of outcomes) {
    if (o.result === 'fixed') fixed++;
    else if (o.result === 'skipped' || o.result === 'cancelled') skipped++;
    else if (o.result === 'refused') refused++;
    else if (o.result === 'failed') failed++;
  }
  return {
    outcomes,
    fixed,
    skipped,
    refused,
    failed,
    remaining: skipped + refused + failed,
  };
}

// ── rendering ──────────────────────────────────────────────────────────────

export function renderRecoveryReport(r: RecoveryReport): string {
  const lines: string[] = [];
  lines.push(
    `recovery: fixed=${r.fixed} skipped=${r.skipped} refused=${r.refused} failed=${r.failed}`,
  );
  if (r.outcomes.length === 0) {
    lines.push('  (아무 이슈도 없음 — doctor 깨끗)');
    return lines.join('\n');
  }
  for (const o of r.outcomes) {
    const icon = resultIcon(o.result);
    const head = `${icon}  [${o.issue.area}] ${o.issue.subject}`;
    lines.push(head);
    lines.push(`     issue: ${o.issue.message}`);
    lines.push(`     plan:  [${o.strategy.tier}] ${o.strategy.reason}`);
    if (o.detail) lines.push(`     detail: ${o.detail}`);
  }
  if (r.remaining > 0) {
    lines.push('');
    lines.push(
      `${r.remaining} 개 이슈가 자동 복구되지 않았습니다 — 위 hint 따라 수동 처리.`,
    );
  }
  return lines.join('\n');
}

function resultIcon(r: RecoveryResult): string {
  switch (r) {
    case 'fixed':
      return '✅';
    case 'skipped':
      return '⏭️';
    case 'refused':
      return '🚫';
    case 'failed':
      return '❌';
    case 'cancelled':
      return '⏸️';
  }
}
