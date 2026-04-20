import { defaultClaudeRoot, defaultHarnessRoot } from '../core/env.ts';
import {
  readPhase,
  writePhase,
  isValidPhase,
  PHASES,
  type Phase,
  type PhaseStatus,
} from '../core/phase.ts';
import {
  defaultClaudeMdPath,
  applyClaudeMdUpdate,
  type ClaudeMdAction,
} from '../core/claude-md.ts';
import { beginTx } from '../core/tx.ts';
import { backupDirTs } from '../core/time.ts';
import { type ConfirmFn } from './config.ts';

export type PhaseErrorCode = 'INVALID_VALUE' | 'IO' | 'CONFIRM_REQUIRED' | 'CLAUDE_MD';

export class PhaseError extends Error {
  readonly code: PhaseErrorCode;
  readonly hint?: string;
  constructor(message: string, code: PhaseErrorCode, hint?: string) {
    super(message);
    this.name = 'PhaseError';
    this.code = code;
    if (hint !== undefined) this.hint = hint;
  }
}

export type PhaseAction =
  | { kind: 'get'; value: Phase | null; path: string; status: PhaseStatus }
  | { kind: 'set'; from: Phase | null; to: Phase; backup: string | null; claudeMd: ClaudeMdAction }
  | { kind: 'noop'; value: Phase }
  | { kind: 'cancelled'; from: Phase | null; to: Phase };

export interface PhaseOptions {
  readonly harnessRoot?: string;
  readonly claudeRoot?: string;
  readonly claudeMdPath?: string;
  readonly yes?: boolean;
  readonly confirm?: ConfirmFn;
  readonly now?: () => Date;
  readonly skipClaudeMd?: boolean;
}

function requireConfirm(prompt: string, opts: PhaseOptions): boolean {
  if (opts.yes) return true;
  if (!opts.confirm) {
    throw new PhaseError(
      `확인 프롬프트 불가 (non-TTY 또는 CI). --yes 플래그로 명시적 승인 필요`,
      'CONFIRM_REQUIRED',
      `acorn phase ${PHASES.join('|')} --yes`,
    );
  }
  return opts.confirm(prompt);
}

export function runPhase(value: string | undefined, opts: PhaseOptions = {}): PhaseAction {
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();
  const claudeRoot = opts.claudeRoot ?? defaultClaudeRoot();
  const claudeMdPath = opts.claudeMdPath ?? defaultClaudeMdPath(claudeRoot);

  // get: 인수 없음
  if (value === undefined) {
    const current = readPhase(harnessRoot);
    return {
      kind: 'get',
      value: current.value,
      path: current.path,
      status: current.status,
    };
  }

  // 값 검증
  if (!isValidPhase(value)) {
    throw new PhaseError(
      `알 수 없는 phase: "${value}". ${PHASES.join('|')} 중 하나여야 합니다.`,
      'INVALID_VALUE',
      `acorn phase ${PHASES.join('|')}`,
    );
  }

  const to: Phase = value;

  // 현재 phase 읽기
  const current = readPhase(harnessRoot);
  const from = current.value;

  // 동일하면 noop
  if (from === to) {
    return { kind: 'noop', value: to };
  }

  // 확인 프롬프트
  const fromLabel = from ?? 'unset';
  const confirmed = requireConfirm(
    `phase 를 ${fromLabel} → ${to} 로 변경합니다.`,
    opts,
  );
  if (!confirmed) {
    return { kind: 'cancelled', from, to };
  }

  // tx 시작
  const backupTs = backupDirTs();
  const tx = beginTx(harnessRoot);
  try {
    tx.phase('phase-set');

    // phase.txt atomic write
    try {
      writePhase(to, harnessRoot);
    } catch (e) {
      throw new PhaseError(
        `phase.txt 쓰기 실패: ${e instanceof Error ? e.message : String(e)}`,
        'IO',
      );
    }

    // CLAUDE.md 마커 주입
    let claudeMdResult: ClaudeMdAction;
    if (opts.skipClaudeMd) {
      claudeMdResult = { kind: 'noop' };
    } else {
      try {
        claudeMdResult = applyClaudeMdUpdate({
          claudeMdPath,
          harnessRoot,
          phase: to,
          backupTs,
        });
      } catch (e) {
        throw new PhaseError(
          `CLAUDE.md 업데이트 실패: ${e instanceof Error ? e.message : String(e)}`,
          'CLAUDE_MD',
        );
      }
    }

    tx.commit();

    const backup =
      claudeMdResult.kind === 'updated' ? claudeMdResult.backup : null;

    return { kind: 'set', from, to, backup, claudeMd: claudeMdResult };
  } catch (e) {
    tx.abort(e instanceof Error ? e.message : String(e));
    throw e;
  }
}

export function renderPhaseAction(a: PhaseAction): string {
  switch (a.kind) {
    case 'get': {
      if (a.value === null) {
        return a.status === 'missing'
          ? `phase: (미설정 — acorn install 로 기본값 dev 초기화)`
          : `phase: (잘못된 값 — ${a.path} 확인 후 acorn phase <값> 으로 재설정)`;
      }
      return `phase: ${a.value}  (${a.path})`;
    }
    case 'set': {
      const fromLabel = a.from ?? 'unset';
      const claudeMdNote =
        a.claudeMd.kind === 'noop'
          ? '(CLAUDE.md 변경 없음)'
          : a.claudeMd.kind === 'created'
            ? '(CLAUDE.md 생성됨)'
            : `(CLAUDE.md 업데이트됨${a.backup ? ` backup: ${a.backup}` : ''})`;
      return `✅ phase 변경: ${fromLabel} → ${a.to}  ${claudeMdNote}`;
    }
    case 'noop':
      return `phase: ${a.value}  (변경 없음 — 이미 해당 phase)`;
    case 'cancelled':
      return `취소됨: phase 변경 (${a.from ?? 'unset'} → ${a.to})`;
  }
}
