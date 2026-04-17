import { existsSync, renameSync } from 'node:fs';

/**
 * §15 v0.3.0 S4 — `acorn install --adopt` 의 핵심 보조 유틸.
 *
 * 원칙 (ADR-018):
 *   Lock 은 진실. 현실이 lock 과 다르면 현실을 이름 바꿔 보존하고
 *   lock 기준으로 덮어쓴다. 삭제는 일절 없음.
 *
 * preAdoptMove 는 원자 rename 1 번으로 원본을 `<path>.pre-adopt-<ISO8601>` 로
 * 이동한다. 동일 ts collision 은 현실적으로 불가능하지만 방어 차원에서 체크.
 */

export interface PreAdoptResult {
  readonly preAdoptPath: string;
}

function isoTs(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function preAdoptPathFor(original: string, ts: string = isoTs()): string {
  return `${original}.pre-adopt-${ts}`;
}

/**
 * original 을 `<original>.pre-adopt-<ts>` 로 rename.
 * - original 미존재 시 throw (상위에서 state 체크 전제)
 * - collision 시 throw (acorn 내부 race 가능성)
 */
export function preAdoptMove(original: string): PreAdoptResult {
  if (!existsSync(original)) {
    throw new Error(`preAdoptMove: 대상이 존재하지 않음: ${original}`);
  }
  const preAdoptPath = preAdoptPathFor(original);
  if (existsSync(preAdoptPath)) {
    throw new Error(
      `preAdoptMove: 충돌 — 이미 존재하는 pre-adopt 경로: ${preAdoptPath}`,
    );
  }
  renameSync(original, preAdoptPath);
  return { preAdoptPath };
}
