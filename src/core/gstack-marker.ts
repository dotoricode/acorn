import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * gstack `./setup --host auto` 가 성공한 후 그 시점의 gstack SHA 를 기록한다.
 * 다음 install 에서 이 SHA 와 일치하면 setup 을 재실행하지 않는다 (§15 C3).
 * 목적: "두 번째 runInstall 은 모든 단계 noop" 불변식 복원.
 *
 * 위치: <harnessRoot>/.gstack-setup.sha — plain text, 40-char SHA + newline.
 * 간단한 단일 파일이라 state 디렉토리 스키마 변경 없이 추가 가능.
 */
export function gstackSetupMarkerPath(harnessRoot: string): string {
  return join(harnessRoot, '.gstack-setup.sha');
}

export function readGstackSetupMarker(harnessRoot: string): string | null {
  const p = gstackSetupMarkerPath(harnessRoot);
  if (!existsSync(p)) return null;
  try {
    const raw = readFileSync(p, 'utf8').trim();
    // 스키마 검증: 40-char hex. 손상 시 null 반환해 setup 재실행 유도 (fail-close).
    if (/^[a-f0-9]{40}$/i.test(raw)) return raw;
    return null;
  } catch {
    return null;
  }
}

export function writeGstackSetupMarker(harnessRoot: string, sha: string): void {
  const p = gstackSetupMarkerPath(harnessRoot);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, `${sha}\n`, 'utf8');
}
