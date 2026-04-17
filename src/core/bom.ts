/**
 * §15 v0.4.1 — UTF-8 BOM 처리 헬퍼 (중복 제거).
 * Windows 에디터(메모장, PowerShell 리디렉션 등) 가 UTF-8 파일 선두에 0xFEFF 를
 * 삽입하면 JSON.parse 가 실패한다. fail-close 원칙 위반 없이 조용히 떼어낸다.
 *
 * 이전: lock.ts 와 config.ts 에 같은 한 줄이 복붙돼 있었고 settings.ts 는
 * 빠져 있어 codex review 4 번 (v0.4.1) 에서 비대칭 fix 로 지적됨. 단일 소스화.
 */
export function stripBom(raw: string): string {
  return raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
}
