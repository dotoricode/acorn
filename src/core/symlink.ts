import {
  symlinkSync,
  lstatSync,
  readlinkSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  existsSync,
  writeFileSync,
} from 'node:fs';
import { platform } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { defaultClaudeRoot, defaultHarnessRoot } from './env.ts';
import { backupDirTs } from './time.ts';
import { AcornError } from './errors.ts';

export type SymlinkErrorCode = 'NOT_SYMLINK' | 'SOURCE_MISSING' | 'IO';

export class SymlinkError extends AcornError<SymlinkErrorCode> {
  readonly target: string;
  constructor(
    message: string,
    code: SymlinkErrorCode,
    target: string,
    hint?: string,
    docsUrl?: string,
  ) {
    super(message, { namespace: 'symlink', code, hint, docsUrl });
    this.name = 'SymlinkError';
    this.target = target;
  }
}

export { defaultClaudeRoot, defaultHarnessRoot };

export function gstackSymlinkPath(claudeRoot?: string): string {
  return join(claudeRoot ?? defaultClaudeRoot(), 'skills', 'gstack');
}

export function gstackSymlinkSource(harnessRoot?: string): string {
  return join(harnessRoot ?? defaultHarnessRoot(), 'vendors', 'gstack');
}

export type SymlinkStatus =
  | 'absent'
  | 'correct'
  | 'wrong_target'
  | 'not_a_symlink';

export interface SymlinkInspection {
  readonly target: string;
  readonly status: SymlinkStatus;
  readonly currentLink: string | null;
  readonly expectedSource: string;
}

/**
 * 경로 비교를 위한 정규화.
 * §15 M4: Windows NTFS 는 케이스-비민감 기본값 → `D:\Foo` 와 `D:\foo` 가
 * 같은 대상을 가리키는데 strict string equality 로는 wrong_target 로 오판.
 * Windows 에선 lowercase 비교, POSIX 에선 strict 유지.
 *
 * export 이유: 테스트 가능하게. 플랫폼 분기가 내부 로직이지만 해당 플랫폼에서
 * 실 symlink 없이 검증하려면 public helper 로 두는 편이 실용적.
 */
export function normalizePathForCompare(
  p: string,
  plat: NodeJS.Platform = platform(),
): string {
  return plat === 'win32' ? p.toLowerCase() : p;
}

export function inspectSymlink(target: string, expectedSource: string): SymlinkInspection {
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    return { target, status: 'absent', currentLink: null, expectedSource };
  }
  if (!stat.isSymbolicLink()) {
    return { target, status: 'not_a_symlink', currentLink: null, expectedSource };
  }
  const link = readlinkSync(target);
  const resolved = resolve(dirname(target), link);
  const expectedResolved = resolve(expectedSource);
  const matches =
    normalizePathForCompare(resolved) === normalizePathForCompare(expectedResolved);
  return {
    target,
    status: matches ? 'correct' : 'wrong_target',
    currentLink: link,
    expectedSource,
  };
}

function symlinkType(): 'dir' | 'junction' | undefined {
  return platform() === 'win32' ? 'junction' : 'dir';
}

function targetExists(target: string): boolean {
  try {
    lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Create or atomically replace a directory symlink.
 * - absent target: symlink(tmp) → rename(tmp, target)
 * - existing symlink: symlink(tmp) → rename(tmp, target) atomically replaces on POSIX.
 *   On Windows/junctions where rename may fail with EEXIST, fall back to unlink+rename.
 *   Only a symlink may be overwritten — callers must guard NOT_SYMLINK upstream.
 */
export function createDirSymlink(source: string, target: string): void {
  if (!existsSync(source)) {
    throw new SymlinkError(`source 부재: ${source}`, 'SOURCE_MISSING', target);
  }
  mkdirSync(dirname(target), { recursive: true });
  const tmp = `${target}.acorn-${process.pid}-${Date.now()}.tmp`;
  try {
    symlinkSync(source, tmp, symlinkType());
  } catch (e) {
    throw new SymlinkError(
      `심링크 생성 실패: ${tmp} → ${source} (${e instanceof Error ? e.message : String(e)})`,
      'IO',
      target,
    );
  }
  try {
    renameSync(tmp, target);
    return;
  } catch (renameErr) {
    if (targetExists(target)) {
      try {
        unlinkSync(target);
      } catch (e) {
        try { unlinkSync(tmp); } catch { /* best effort */ }
        throw new SymlinkError(
          `기존 target 제거 실패: ${target} (${e instanceof Error ? e.message : String(e)})`,
          'IO',
          target,
        );
      }
      try {
        renameSync(tmp, target);
        return;
      } catch (e) {
        try { unlinkSync(tmp); } catch { /* best effort */ }
        throw new SymlinkError(
          `rename 재시도 실패: ${tmp} → ${target} (${e instanceof Error ? e.message : String(e)})`,
          'IO',
          target,
        );
      }
    }
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw new SymlinkError(
      `rename 실패: ${tmp} → ${target} (${renameErr instanceof Error ? renameErr.message : String(renameErr)})`,
      'IO',
      target,
    );
  }
}

export type EnsureAction = 'noop' | 'created' | 'replaced';

export interface EnsureResult {
  readonly action: EnsureAction;
  readonly target: string;
  readonly source: string;
  readonly previousLink: string | null;
  readonly backup?: string;
}

/**
 * wrong_target 교체 직전에 현재 symlink 의 메타 (link target + target path + ts)
 * 를 JSON 파일로 보관한다. 실제 교체는 atomic rename 이 담당하므로
 * 이 info 파일은 사후 복구용 기록이다.
 * §15 C4: "symlink 교체 시 백업 없음 → 비파괴 원칙 위반" 해소.
 * §15 M2 의 "symlinks/{path}.info 미생성" 도 같은 갭 — 여기서 충족.
 */
export function backupSymlinkInfo(opts: {
  target: string;
  linkTarget: string | null;
  backupDir: string;
  reason: string;
}): string {
  const { target, linkTarget, backupDir, reason } = opts;
  mkdirSync(backupDir, { recursive: true });
  const infoPath = join(backupDir, `${basename(target)}.info`);
  const info = {
    target,
    link_target: linkTarget,
    backed_up_at: new Date().toISOString(),
    reason,
  };
  writeFileSync(infoPath, JSON.stringify(info, null, 2), 'utf8');
  return infoPath;
}

export interface EnsureSymlinkOptions {
  /** wrong_target 교체 시 info 백업 대상 디렉토리. 미지정이면 백업 생략. */
  readonly backupDir?: string;
}

export function ensureSymlink(
  source: string,
  target: string,
  opts: EnsureSymlinkOptions = {},
): EnsureResult {
  const inspection = inspectSymlink(target, source);
  switch (inspection.status) {
    case 'correct':
      return { action: 'noop', target, source, previousLink: inspection.currentLink };
    case 'not_a_symlink':
      throw new SymlinkError(
        `심링크가 아닌 항목 존재 — 자동 교체 거부 (수동 처리 필요): ${target}`,
        'NOT_SYMLINK',
        target,
      );
    case 'wrong_target': {
      const prev = inspection.currentLink;
      // §15 C4: 교체 전에 info 백업 (backupDir 제공된 경우).
      let backup: string | undefined;
      if (opts.backupDir) {
        backup = backupSymlinkInfo({
          target,
          linkTarget: prev,
          backupDir: opts.backupDir,
          reason: 'ensureSymlink wrong_target → replace',
        });
      }
      createDirSymlink(source, target);
      return backup !== undefined
        ? { action: 'replaced', target, source, previousLink: prev, backup }
        : { action: 'replaced', target, source, previousLink: prev };
    }
    case 'absent':
      createDirSymlink(source, target);
      return { action: 'created', target, source, previousLink: null };
  }
}

export interface InstallGstackOptions {
  readonly harnessRoot?: string;
  readonly claudeRoot?: string;
  /**
   * §15 v0.5.1 (부채 #5): runInstall 1회 실행의 모든 백업 (symlink / hooks /
   * settings) 이 공유하는 디렉토리 ts. 미지정 시 이 함수 호출 시점 기준으로
   * 새로 찍음 (이전 동작 호환). runInstall 은 진입부에서 1회 ts 계산해 주입.
   */
  readonly backupTs?: string;
}

export function installGstackSymlink(opts: InstallGstackOptions = {}): EnsureResult {
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();
  const source = gstackSymlinkSource(harnessRoot);
  const target = gstackSymlinkPath(opts.claudeRoot);
  // §15 C4: wrong_target 교체 시 <harnessRoot>/backup/{ISO8601}/symlinks/ 에 info 백업.
  const backupDir = join(
    harnessRoot,
    'backup',
    opts.backupTs ?? backupDirTs(),
    'symlinks',
  );
  return ensureSymlink(source, target, { backupDir });
}

export function inspectGstackSymlink(opts: InstallGstackOptions = {}): SymlinkInspection {
  const source = gstackSymlinkSource(opts.harnessRoot);
  const target = gstackSymlinkPath(opts.claudeRoot);
  return inspectSymlink(target, source);
}
