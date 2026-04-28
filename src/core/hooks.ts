import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  statSync,
  copyFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { backupDirTs } from './time.ts';
import { type AnyHarnessLock } from './lock.ts';
import { AcornError } from './errors.ts';

// ── hooks capability status (v3) ──────────────────────────────────────────────

/**
 * 'provider-managed': v3 lock + hooks capability 에 제공자 지정됨.
 * 훅 설치는 해당 제공자(예: claudekit)가 담당 — acorn 은 registry 복제하지 않음.
 *
 * 'legacy-fallback': v2 lock 이거나 hooks capability 가 미설정.
 * installGuardHook 으로 guard-check.sh 단일 파일 배포.
 */
export type HooksCapabilityMode = 'provider-managed' | 'legacy-fallback';

export interface HooksCapabilityStatus {
  readonly mode: HooksCapabilityMode;
  readonly providers: readonly string[];
}

export function hooksCapabilityStatus(lock: AnyHarnessLock): HooksCapabilityStatus {
  if (lock.schema_version !== 3) {
    return { mode: 'legacy-fallback', providers: [] };
  }
  const hooksCap = lock.capabilities['hooks'];
  if (!hooksCap || hooksCap.providers.length === 0) {
    return { mode: 'legacy-fallback', providers: [] };
  }
  return { mode: 'provider-managed', providers: [...hooksCap.providers] };
}

export type HooksErrorCode = 'SOURCE_MISSING' | 'IO';

export class HooksError extends AcornError<HooksErrorCode> {
  constructor(
    message: string,
    code: HooksErrorCode,
    hint?: string,
    docsUrl?: string,
  ) {
    super(message, { namespace: 'hooks', code, hint, docsUrl });
    this.name = 'HooksError';
  }
}

export type HooksAction = 'created' | 'updated' | 'noop';

export interface HooksResult {
  readonly action: HooksAction;
  readonly target: string;
  readonly backup?: string;
}

const HOOK_MODE = 0o755;

/**
 * 패키지 동봉된 hooks/guard-check.sh 의 절대 경로.
 * dev (src/core/hooks.ts) 와 prod (dist/core/hooks.js) 양쪽에서 동일하게 해소.
 */
export function packagedHookPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, '..', '..', 'hooks', 'guard-check.sh');
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * <harnessRoot>/hooks/guard-check.sh 를 패키지 동봉본에서 배포한다.
 * ADR-017 명세:
 *   - 멱등: 내용 hash + mode 동일 → noop
 *   - 비파괴: 내용 다르면 <harnessRoot>/backup/{ISO8601}/hooks/ 에 백업 후 교체
 *   - 실행권: chmod 0o755 (Windows 는 무시)
 * §15 C2: settings.json 이 참조하는 hook 이 install 로 배달되지 않던 갭 해소.
 *
 * §15 v0.5.1 (부채 #5): `backupTs` 를 주입받아 `runInstall` 1회 실행의 모든
 * 백업 (symlink / hooks / settings) 이 같은 디렉토리를 공유하도록 한다.
 * 이전엔 각 호출 시점에 `new Date()` 를 찍어 1회 install 에 3개 백업
 * 디렉토리가 ms 단위로 조각나 추적이 어려웠다.
 */
export function installGuardHook(
  harnessRoot: string,
  backupTs: string = backupDirTs(),
): HooksResult {
  const source = packagedHookPath();
  if (!existsSync(source)) {
    throw new HooksError(
      `패키지 동봉 hook 파일 누락: ${source}`,
      'SOURCE_MISSING',
    );
  }

  const targetDir = join(harnessRoot, 'hooks');
  const target = join(targetDir, 'guard-check.sh');

  const srcBuf = readFileSync(source);
  const srcHash = sha256(srcBuf);

  mkdirSync(targetDir, { recursive: true });

  if (existsSync(target)) {
    const existingBuf = readFileSync(target);
    const existingHash = sha256(existingBuf);
    const existingMode = statSync(target).mode & 0o777;
    // Windows: mode bits 가 NTFS 에서 의미 약함. 내용만 비교.
    const modeMatches =
      process.platform === 'win32' || existingMode === HOOK_MODE;
    if (existingHash === srcHash && modeMatches) {
      return { action: 'noop', target };
    }
    // 내용/mode 가 다름 → 백업 후 원자 교체
    const backupPath = join(
      harnessRoot,
      'backup',
      backupTs,
      'hooks',
      'guard-check.sh.bak',
    );
    mkdirSync(dirname(backupPath), { recursive: true });
    copyFileSync(target, backupPath);
    writeFileSync(target, srcBuf);
    if (process.platform !== 'win32') chmodSync(target, HOOK_MODE);
    return { action: 'updated', target, backup: backupPath };
  }

  // 신규 설치
  writeFileSync(target, srcBuf);
  if (process.platform !== 'win32') chmodSync(target, HOOK_MODE);
  return { action: 'created', target };
}
