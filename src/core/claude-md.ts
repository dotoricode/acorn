import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultClaudeRoot, defaultHarnessRoot } from './env.ts';
import { backupDirTs } from './time.ts';
import { type Phase } from './phase.ts';

export const PHASE_MARKER_START = '<!-- ACORN:PHASE:START -->';
export const PHASE_MARKER_END = '<!-- ACORN:PHASE:END -->';

export type ClaudeMdErrorCode = 'PARSE' | 'IO' | 'MARKER_CORRUPT';

export class ClaudeMdError extends Error {
  readonly code: ClaudeMdErrorCode;
  constructor(message: string, code: ClaudeMdErrorCode) {
    super(message);
    this.name = 'ClaudeMdError';
    this.code = code;
  }
}

export interface ClaudeMdPlan {
  readonly action: 'noop' | 'update' | 'create';
  readonly currentBlock: string | null;
  readonly nextBlock: string;
  readonly nextText: string;
}

export type ClaudeMdAction =
  | { kind: 'noop' }
  | { kind: 'updated'; backup: string | null }
  | { kind: 'created'; path: string };

export function defaultClaudeMdPath(claudeRoot?: string): string {
  return join(claudeRoot ?? defaultClaudeRoot(), 'CLAUDE.md');
}

function phaseSpecificLines(phase: Phase): string[] {
  switch (phase) {
    case 'prototype':
      return [
        '- guard 수준: minimal — 되돌릴 수 없는 catastrophic 조작만 차단',
        '- 빠른 탐색 우선, fail-fast 보다 진행 우선',
        '- phase 변경: `acorn phase <prototype|dev|production>`',
      ];
    case 'dev':
      return [
        '- guard 수준: moderate',
        '- 체크인 전 `acorn doctor` 로 drift 확인',
        '- phase 변경: `acorn phase <prototype|dev|production>`',
      ];
    case 'production':
      return [
        '- guard 수준: strict — 모든 파괴적 패턴 차단',
        '- 변경 전 `acorn status` 로 상태 확인 필수',
        '- phase 변경: `acorn phase <prototype|dev|production>`',
      ];
  }
}

export function renderPhaseBlock(phase: Phase): string {
  const lines: string[] = [
    PHASE_MARKER_START,
    `## Acorn Phase: ${phase}`,
    '',
    `이 프로젝트는 현재 **${phase}** 단계입니다 (acorn 이 관리).`,
    '',
    ...phaseSpecificLines(phase),
    '',
    `ACORN_PHASE_KEYWORD: ${phase}`,
    PHASE_MARKER_END,
  ];
  return lines.join('\n');
}

export function extractPhaseFromBlock(block: string): Phase | null {
  const match = /^ACORN_PHASE_KEYWORD:\s*(\S+)$/m.exec(block);
  if (!match || !match[1]) return null;
  const v = match[1];
  if (v === 'prototype' || v === 'dev' || v === 'production') return v;
  return null;
}

export function planClaudeMdUpdate(current: string | null, phase: Phase): ClaudeMdPlan {
  const nextBlock = renderPhaseBlock(phase);

  if (current === null) {
    return {
      action: 'create',
      currentBlock: null,
      nextBlock,
      nextText: `${nextBlock}\n`,
    };
  }

  const startIdx = current.indexOf(PHASE_MARKER_START);
  const endIdx = current.indexOf(PHASE_MARKER_END);

  // START 있고 END 없음: 손상
  if (startIdx !== -1 && endIdx === -1) {
    throw new ClaudeMdError(
      `CLAUDE.md 에 ${PHASE_MARKER_START} 는 있지만 ${PHASE_MARKER_END} 가 없습니다. ` +
        `마커가 손상됐을 가능성. 수동 점검 후 마커 블록을 제거하거나 복구하세요.`,
      'MARKER_CORRUPT',
    );
  }

  // END 있고 START 없음: 고아 END 마커 → 손상
  if (startIdx === -1 && endIdx !== -1) {
    throw new ClaudeMdError(
      `CLAUDE.md 에 ${PHASE_MARKER_END} 는 있지만 ${PHASE_MARKER_START} 가 없습니다. ` +
        `마커가 손상됐을 가능성. 수동 점검 후 마커 블록을 제거하거나 복구하세요.`,
      'MARKER_CORRUPT',
    );
  }

  // END 가 START 보다 앞에 있음: 순서 역전 → 손상
  if (startIdx !== -1 && endIdx < startIdx) {
    throw new ClaudeMdError(
      `CLAUDE.md 마커 순서 역전: ${PHASE_MARKER_END} 가 ${PHASE_MARKER_START} 보다 앞에 있습니다. ` +
        `수동 점검 후 마커 블록을 복구하세요.`,
      'MARKER_CORRUPT',
    );
  }

  if (startIdx === -1) {
    // 마커 없음 → 파일 말미에 추가
    const separator = current.endsWith('\n') ? '\n' : '\n\n';
    return {
      action: 'update',
      currentBlock: null,
      nextBlock,
      nextText: `${current}${separator}${nextBlock}\n`,
    };
  }

  // 마커 존재 → 기존 블록 치환
  const currentBlock = current.slice(startIdx, endIdx + PHASE_MARKER_END.length);
  const existingPhase = extractPhaseFromBlock(currentBlock);
  if (existingPhase === phase) {
    return {
      action: 'noop',
      currentBlock,
      nextBlock,
      nextText: current,
    };
  }

  const nextText = current.slice(0, startIdx) + nextBlock + current.slice(endIdx + PHASE_MARKER_END.length);
  return {
    action: 'update',
    currentBlock,
    nextBlock,
    nextText,
  };
}

function backupClaudeMd(claudeMdPath: string, harnessRoot: string, ts: string): string | null {
  if (!existsSync(claudeMdPath)) return null;
  const dir = join(harnessRoot, 'backup', ts, 'claude-md');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, 'CLAUDE.md.bak');
  copyFileSync(claudeMdPath, dest);
  return dest;
}

function atomicWriteText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.acorn-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o644 });
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw new ClaudeMdError(
      `CLAUDE.md 쓰기 실패: ${path} (${e instanceof Error ? e.message : String(e)})`,
      'IO',
    );
  }
}

export function applyClaudeMdUpdate(opts: {
  readonly claudeMdPath: string;
  readonly harnessRoot: string;
  readonly phase: Phase;
  readonly backupTs?: string;
}): ClaudeMdAction {
  const { claudeMdPath, harnessRoot, phase } = opts;
  const backupTs = opts.backupTs ?? backupDirTs();

  let current: string | null = null;
  if (existsSync(claudeMdPath)) {
    try {
      current = readFileSync(claudeMdPath, 'utf8');
    } catch (e) {
      throw new ClaudeMdError(
        `CLAUDE.md 읽기 실패: ${claudeMdPath} (${e instanceof Error ? e.message : String(e)})`,
        'IO',
      );
    }
  }

  const plan = planClaudeMdUpdate(current, phase);

  if (plan.action === 'noop') {
    return { kind: 'noop' };
  }

  const backup = backupClaudeMd(claudeMdPath, harnessRoot, backupTs);
  atomicWriteText(claudeMdPath, plan.nextText);

  if (plan.action === 'create') {
    return { kind: 'created', path: claudeMdPath };
  }

  return { kind: 'updated', backup };
}

export function readPhaseFromClaudeMd(claudeMdPath?: string): Phase | null {
  const path = claudeMdPath ?? defaultClaudeMdPath();
  if (!existsSync(path)) return null;
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const startIdx = content.indexOf(PHASE_MARKER_START);
  const endIdx = content.indexOf(PHASE_MARKER_END);
  if (startIdx === -1 || endIdx === -1) return null;
  const block = content.slice(startIdx, endIdx + PHASE_MARKER_END.length);
  return extractPhaseFromBlock(block);
}

export function claudeMdMarkerStatus(
  claudeMdPath: string,
  expectedPhase: Phase | null,
): 'ok' | 'missing' | 'mismatch' | 'corrupt' {
  if (!existsSync(claudeMdPath)) return 'missing';
  let content: string;
  try {
    content = readFileSync(claudeMdPath, 'utf8');
  } catch {
    return 'missing';
  }
  const startIdx = content.indexOf(PHASE_MARKER_START);
  const endIdx = content.indexOf(PHASE_MARKER_END);
  if (startIdx === -1 && endIdx === -1) return 'missing';
  if (startIdx !== -1 && endIdx === -1) return 'corrupt';
  if (startIdx === -1 && endIdx !== -1) return 'corrupt';
  const block = content.slice(startIdx, endIdx + PHASE_MARKER_END.length);
  const found = extractPhaseFromBlock(block);
  if (found === null) return 'corrupt';
  if (expectedPhase === null || found === expectedPhase) return 'ok';
  return 'mismatch';
}

export function defaultHarnessBackupRoot(harnessRoot?: string): string {
  return join(harnessRoot ?? defaultHarnessRoot(), 'backup');
}
