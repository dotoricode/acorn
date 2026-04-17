/**
 * SHA 디스플레이 유틸 (§15 v0.2.0 S2 / Round 2 S4 실증).
 * 기존엔 모든 곳에서 7-char short SHA 만 보여주다 보니 drift 메시지에서
 * `lock=c6e6a21, 실제=c6e6a21` 같은 "다른데 같아 보이는" 착시가 생김
 * (끝 자리만 1 글자 다르고 prefix 는 일치하는 경우).
 *
 * distinguishingPair 는 두 SHA 의 첫 차이 위치까지 확장해서 보여준다.
 * 같은 prefix 인 경우에도 차이 나는 지점이 눈에 보이게 한다.
 */

export const DEFAULT_MIN = 7;
const MAX = 40;

export function shortSha(sha: string, minLen: number = DEFAULT_MIN): string {
  return sha.slice(0, minLen);
}

/**
 * 두 SHA 의 첫 차이 인덱스까지 포함해서 짝을 반환한다.
 * - 둘 다 동일: 7자만 반환 (minLen)
 * - 일부 prefix 공유 + 차이: 차이 난 위치 + 1 을 포함하는 길이로 자른다
 * - b 가 null: [shortSha(a), 'unknown'] 반환
 */
export function distinguishingPair(
  a: string,
  b: string | null | undefined,
  minLen: number = DEFAULT_MIN,
): [string, string] {
  if (b === null || b === undefined) return [shortSha(a, minLen), 'unknown'];
  if (a === b) return [shortSha(a, minLen), shortSha(b, minLen)];
  let i = 0;
  const limit = Math.min(a.length, b.length);
  while (i < limit && a[i] === b[i]) i++;
  // 차이 위치 + 1 까지 보여준다. 최소 minLen, 최대 MAX.
  const showLen = Math.max(minLen, Math.min(i + 1, MAX));
  return [a.slice(0, showLen), b.slice(0, showLen)];
}
