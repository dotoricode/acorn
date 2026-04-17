/**
 * §15 v0.5.1 (부채 #4) — 타임스탬프 유틸 단일 소스.
 *
 * 이전: `new Date().toISOString().replace(/[:.]/g, '-')` 가 5 곳 (adopt /
 * config / hooks / symlink / settings) 에 복붙돼 있었고 이름도 `isoTs` /
 * `isoTimestamp` / `timestampDirName` 으로 제각각. checkpoint 🟡#4 정리.
 *
 * 반환 형식: `YYYY-MM-DDTHH-mm-ss-sssZ` — `:` 와 `.` 을 `-` 로 치환해
 * Windows 파일시스템 안전. 디렉토리/파일명에 사용.
 *
 * tx.log 의 raw ISO ts (`new Date().toISOString()`) 는 `isoTsRaw` 별도.
 */

export function backupDirTs(now: Date = new Date()): string {
  return now.toISOString().replace(/[:.]/g, '-');
}

export function isoTsRaw(now: Date = new Date()): string {
  return now.toISOString();
}
