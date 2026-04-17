import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { defaultHarnessRoot } from './env.ts';
import { preAdoptMove } from './adopt.ts';

export type VendorErrorCode =
  | 'GIT_MISSING'
  | 'CLONE'
  | 'CHECKOUT'
  | 'REV_PARSE'
  | 'NOT_A_REPO'
  | 'SHA_MISMATCH'
  | 'LOCAL_CHANGES'
  | 'TIMEOUT'
  | 'IO';

export class VendorError extends Error {
  readonly code: VendorErrorCode;
  readonly tool: string;
  constructor(message: string, code: VendorErrorCode, tool: string) {
    super(message);
    this.name = 'VendorError';
    this.code = code;
    this.tool = tool;
  }
}

export interface GitRunner {
  clone(repoUrl: string, dir: string): void;
  checkout(dir: string, commit: string): void;
  revParse(dir: string): string;
  isGitRepo(dir: string): boolean;
  isDirty(dir: string): boolean;
  /**
   * Working-tree 의 dirty 경로 목록 (repo-relative, POSIX slash).
   * `git status --porcelain` 기반. 구현되지 않은 GitRunner(레거시) 는 isDirty
   * 로 폴백 — 이 경우 빈 배열 또는 `['<unknown>']` 를 반환할 수 있다.
   */
  getDirtyPaths?(dir: string): readonly string[];
}

/**
 * 툴별 "기대되는 dirty 경로" 허용 리스트.
 * 해당 툴의 setup/init 이 정상적으로 생성하는 untracked 산출물.
 * prefix 매칭 (e.g. '.agents/' 은 '.agents/skills/foo' 도 허용).
 * (DOGFOOD Round 1 §v0.1.1 #5)
 */
export const EXPECTED_DIRTY_PATHS: Readonly<Record<string, readonly string[]>> = {
  omc: [],
  gstack: ['.agents/'],
  ecc: [],
};

/**
 * 주어진 dirty 경로 목록에서 "기대되지 않은" 것만 추려낸다.
 * 빈 배열이면 clean 으로 간주해도 안전.
 */
export function unexpectedDirtyPaths(
  tool: string,
  paths: readonly string[],
): readonly string[] {
  const allow = EXPECTED_DIRTY_PATHS[tool] ?? [];
  return paths.filter((p) => !allow.some((prefix) => p.startsWith(prefix)));
}

export const DEFAULT_GIT_TIMEOUT_MS = 120_000;

export function defaultVendorsRoot(harnessRoot?: string): string {
  return join(harnessRoot ?? defaultHarnessRoot(), 'vendors');
}

export function toRepoUrl(repo: string): string {
  return `https://github.com/${repo}.git`;
}

function run(cmd: string, args: readonly string[], cwd?: string): string {
  try {
    return execFileSync(cmd, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: DEFAULT_GIT_TIMEOUT_MS,
    }).toString();
  } catch (e) {
    const err = e as NodeJS.ErrnoException & {
      stderr?: Buffer | string;
      signal?: string | null;
    };
    const stderr =
      typeof err.stderr === 'string'
        ? err.stderr
        : err.stderr?.toString('utf8') ?? '';
    const detail = stderr.trim() || err.message;
    const timedOut =
      err.code === 'ETIMEDOUT' || err.signal === 'SIGTERM';
    const prefix = timedOut ? `[timeout ${DEFAULT_GIT_TIMEOUT_MS}ms] ` : '';
    throw new Error(`${prefix}${cmd} ${args.join(' ')}: ${detail}`);
  }
}

export const defaultGitRunner: GitRunner = {
  clone(repoUrl, dir) {
    run('git', ['clone', '--quiet', repoUrl, dir]);
  },
  checkout(dir, commit) {
    run('git', ['-C', dir, 'checkout', '--quiet', commit]);
  },
  revParse(dir) {
    return run('git', ['-C', dir, 'rev-parse', 'HEAD']).trim();
  },
  isGitRepo(dir) {
    if (!existsSync(join(dir, '.git'))) return false;
    try {
      run('git', ['-C', dir, 'rev-parse', '--git-dir']);
      return true;
    } catch {
      return false;
    }
  },
  isDirty(dir) {
    const out = run('git', ['-C', dir, 'status', '--porcelain']);
    return out.trim().length > 0;
  },
  getDirtyPaths(dir) {
    // `git status --porcelain` 형식: "XY <path>" (XY 2바이트 + 공백 + 경로).
    // untracked 는 "?? <path>", modified 는 " M <path>" 등.
    // 경로는 POSIX slash 로 반환되지만 공백/특수문자는 따옴표가 붙을 수 있음.
    // 단순 prefix 매칭용이므로 따옴표는 제거하고 그대로 사용.
    const out = run('git', ['-C', dir, 'status', '--porcelain']);
    const paths: string[] = [];
    for (const line of out.split('\n')) {
      if (line.length < 4) continue;
      let p = line.slice(3);
      // rename 형식 "R  old -> new" 는 new 만 취함
      const arrow = p.indexOf(' -> ');
      if (arrow >= 0) p = p.slice(arrow + 4);
      // 따옴표 제거
      if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
      paths.push(p);
    }
    return paths;
  },
};

/**
 * Return the current HEAD SHA of a vendor directory.
 * Used by status/doctor to compare disk state against harness.lock.
 */
export function readCurrentCommit(
  vendorPath: string,
  git: GitRunner = defaultGitRunner,
): string {
  return git.revParse(vendorPath);
}

export type VendorAction =
  | 'noop'
  | 'cloned'
  | 'checked_out'
  | 'adopted' // §15 S4: 기존 git 저장소 흡수 (실 checkout 없이 lock SHA 일치 확인만)
  | 'preserved'; // §15 S4: vendor 경로가 심링크 — 사용자 dev 레포로 간주, 건드리지 않음

export interface InstallVendorOptions {
  readonly tool: string;
  readonly repo: string;
  readonly commit: string;
  readonly vendorsRoot: string;
  readonly git?: GitRunner;
  /** §15 S4: `--adopt` — 기존 non-git 디렉토리면 이름 바꿔 보존 후 clone */
  readonly adopt?: boolean;
  /** §15 S4: `--follow-symlink` — 심링크 vendor 의 target HEAD 로 lock SHA 확인 */
  readonly followSymlink?: boolean;
}

export interface InstallVendorResult {
  readonly tool: string;
  readonly action: VendorAction;
  readonly path: string;
  readonly previousCommit: string | null;
  readonly commit: string;
  /** adopt 시 이름 바뀐 보존 경로 */
  readonly preAdoptPath?: string;
}

/**
 * 디렉토리가 비었는지 판정.
 * §15 H4: 이전엔 readdirSync 예외를 catch 로 삼켜 false 반환했다.
 * 그 결과 EACCES(권한)·ENOTDIR 같은 실 장애가 "not empty" 로 둔갑,
 * 다음 분기인 isGitRepo 가 NOT_A_REPO 로 잘못 결론을 내고
 * 사용자는 "rm -rf" 힌트를 받아 엉뚱한 조치를 취할 위험이 있었다.
 *
 * 현재: ENOENT (existsSync 와 readdirSync 사이 race) 만 "비었다" 로 받고,
 * 그 외 에러는 호출자에게 propagate.
 *
 * §15 v0.4.2 (Round 3 dogfood): 심링크는 "empty dir" 이 아니다.
 * 이전엔 `readdirSync` 가 심링크를 follow 해 target 의 empty 여부를 반환,
 * target 이 빈 디렉토리인 심링크가 `treatAsClone=true` 로 판정돼
 * `--follow-symlink` handling 경로가 차단되고 심링크가 clone 대상으로
 * rm 된 뒤 clone 이 시도되는 회귀. v0.3.4 부터 CI Linux 에서 H-3 회귀
 * 테스트 실패 (Windows 는 EPERM 으로 skip 되어 로컬엔 안 보였음).
 * 이제 lstat 기준 심링크면 즉시 false — 심링크 handling 은 상위에서 담당.
 */
function isEmptyDir(dir: string): boolean {
  if (!existsSync(dir)) return true;
  try {
    if (lstatSync(dir).isSymbolicLink()) return false;
    return readdirSync(dir).length === 0;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return true;
    throw e;
  }
}

function cleanupPartial(path: string, tool: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (e) {
    throw new VendorError(
      `partial clone 정리 실패: ${path} (${e instanceof Error ? e.message : String(e)})`,
      'IO',
      tool,
    );
  }
}

export function installVendor(opts: InstallVendorOptions): InstallVendorResult {
  const git = opts.git ?? defaultGitRunner;
  const path = join(opts.vendorsRoot, opts.tool);
  mkdirSync(opts.vendorsRoot, { recursive: true });

  // §15 H4: isEmptyDir 가 EACCES 같은 실 장애를 NOT_A_REPO 로 둔갑시키지 않도록
  // propagate 하고, 여기서 정확한 VendorError(IO) 로 번역한다.
  let treatAsClone: boolean;
  try {
    treatAsClone = !existsSync(path) || isEmptyDir(path);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? 'unknown';
    throw new VendorError(
      `vendor 경로 접근 실패 (${code}): ${path} ` +
        `(${e instanceof Error ? e.message : String(e)}). ` +
        `NOT_A_REPO 로 둔갑되지 않도록 propagate. ` +
        `디렉토리 권한/소유자 확인 후 재실행.`,
      'IO',
      opts.tool,
    );
  }

  if (treatAsClone) {
    if (existsSync(path)) {
      try {
        rmSync(path, { recursive: true, force: true });
      } catch (e) {
        throw new VendorError(
          `빈 디렉토리 제거 실패: ${path} (${e instanceof Error ? e.message : String(e)})`,
          'IO',
          opts.tool,
        );
      }
    }
    try {
      git.clone(toRepoUrl(opts.repo), path);
    } catch (e) {
      cleanupPartial(path, opts.tool);
      throw new VendorError(
        `clone 실패: ${opts.repo} → ${path} (${e instanceof Error ? e.message : String(e)})`,
        'CLONE',
        opts.tool,
      );
    }
    try {
      git.checkout(path, opts.commit);
    } catch (e) {
      cleanupPartial(path, opts.tool);
      throw new VendorError(
        `checkout 실패: ${opts.commit} (${e instanceof Error ? e.message : String(e)})`,
        'CHECKOUT',
        opts.tool,
      );
    }
    try {
      verifyCommit(git, path, opts.commit, opts.tool);
    } catch (e) {
      cleanupPartial(path, opts.tool);
      throw e;
    }
    return {
      tool: opts.tool,
      action: 'cloned',
      path,
      previousCommit: null,
      commit: opts.commit,
    };
  }

  // §15 S4 / ADR-019: 심링크 vendor 는 "사용자 dev 레포" 로 간주.
  // v0.3.1 B1 hotfix: 명시적 `--follow-symlink` opt-in 없이 심링크를 만나면
  // silent preserve 대신 NOT_A_REPO 로 fail-close. v0.3.0 은 검증 없이 success
  // 를 반환해 v0.2.0 의 "자동 교체 거부" 계약을 회귀시켰다.
  let isSymlink = false;
  try {
    isSymlink = lstatSync(path).isSymbolicLink();
  } catch {
    // ignore — 상위 처리
  }
  if (isSymlink) {
    if (!opts.followSymlink) {
      throw new VendorError(
        `vendor 경로가 심링크 — lock SHA 검증을 위해 --follow-symlink 필요, ` +
          `또는 심링크 제거 후 재실행: ${path}`,
        'NOT_A_REPO',
        opts.tool,
      );
    }
    // v0.3.4 H-3: --follow-symlink 는 "lock SHA 기준으로 target 을 검증" 의미.
    // v0.3.0 ~ v0.3.3 은 revParse throw 를 silent 흡수 → preserved 로 success
    // 반환 → drift 고지 실패. 이제 4 단계로 명확히 분기:
    //   - target 이 git 저장소 아님 → NOT_A_REPO
    //   - revParse 실행 실패 (git 바이너리/권한 문제 등) → REV_PARSE
    //   - HEAD 가 lock SHA 와 불일치 → SHA_MISMATCH (drift 명시)
    //   - HEAD 일치 → adopted (유일한 success)
    if (!git.isGitRepo(path)) {
      throw new VendorError(
        `--follow-symlink: 심링크 target 이 git 저장소가 아님: ${path}. ` +
          `심링크 제거 또는 target 을 올바른 git 저장소로 교체 후 재실행.`,
        'NOT_A_REPO',
        opts.tool,
      );
    }
    let head: string;
    try {
      head = git.revParse(path);
    } catch (e) {
      throw new VendorError(
        `--follow-symlink: 심링크 target HEAD 읽기 실패: ${path} ` +
          `(${e instanceof Error ? e.message : String(e)})`,
        'REV_PARSE',
        opts.tool,
      );
    }
    if (head !== opts.commit) {
      throw new VendorError(
        `--follow-symlink: 심링크 target HEAD(${head.slice(0, 7)}) 가 ` +
          `lock SHA(${opts.commit.slice(0, 7)}) 와 불일치 — drift 확정. ` +
          `조치: cd ${path} && git checkout ${opts.commit} ` +
          `(또는 acorn lock bump 로 upstream 반영 — v0.4+ 예정)`,
        'SHA_MISMATCH',
        opts.tool,
      );
    }
    return {
      tool: opts.tool,
      action: 'adopted',
      path,
      previousCommit: head,
      commit: opts.commit,
    };
  }

  if (!git.isGitRepo(path)) {
    if (opts.adopt) {
      // §15 S4 / ADR-018: Lock 은 진실. 현실을 이름 바꿔 보존한 뒤 lock 기준으로 clone.
      const moved = preAdoptMove(path);
      try {
        git.clone(toRepoUrl(opts.repo), path);
      } catch (e) {
        cleanupPartial(path, opts.tool);
        throw new VendorError(
          `adopt 후 clone 실패: ${opts.repo} → ${path} (${e instanceof Error ? e.message : String(e)})`,
          'CLONE',
          opts.tool,
        );
      }
      try {
        git.checkout(path, opts.commit);
      } catch (e) {
        cleanupPartial(path, opts.tool);
        throw new VendorError(
          `adopt 후 checkout 실패: ${opts.commit} (${e instanceof Error ? e.message : String(e)})`,
          'CHECKOUT',
          opts.tool,
        );
      }
      try {
        verifyCommit(git, path, opts.commit, opts.tool);
      } catch (e) {
        cleanupPartial(path, opts.tool);
        throw e;
      }
      return {
        tool: opts.tool,
        action: 'adopted',
        path,
        previousCommit: null,
        commit: opts.commit,
        preAdoptPath: moved.preAdoptPath,
      };
    }
    throw new VendorError(
      `기존 경로가 git 저장소가 아님 — 자동 교체 거부: ${path}`,
      'NOT_A_REPO',
      opts.tool,
    );
  }

  let head: string;
  try {
    head = git.revParse(path);
  } catch (e) {
    throw new VendorError(
      `rev-parse 실패: ${path} (${e instanceof Error ? e.message : String(e)})`,
      'REV_PARSE',
      opts.tool,
    );
  }

  if (head === opts.commit) {
    return {
      tool: opts.tool,
      action: 'noop',
      path,
      previousCommit: head,
      commit: opts.commit,
    };
  }

  // About to checkout a different SHA — reject dirty working tree to protect user work.
  // 단, 툴별 EXPECTED_DIRTY_PATHS (예: gstack 의 .agents/) 는 setup 부산물로 간주하고 무시.
  const dirtyPaths = git.getDirtyPaths
    ? git.getDirtyPaths(path)
    : git.isDirty(path)
      ? (['<unknown>'] as const)
      : ([] as const);
  const unexpected = unexpectedDirtyPaths(opts.tool, dirtyPaths);
  if (unexpected.length > 0) {
    throw new VendorError(
      `vendor 에 로컬 변경 감지 — 자동 checkout 거부: ${path} ` +
        `(paths: ${unexpected.slice(0, 5).join(', ')}${unexpected.length > 5 ? ' ...' : ''})`,
      'LOCAL_CHANGES',
      opts.tool,
    );
  }

  try {
    git.checkout(path, opts.commit);
  } catch (e) {
    throw new VendorError(
      `checkout 실패: ${opts.commit} (${e instanceof Error ? e.message : String(e)})`,
      'CHECKOUT',
      opts.tool,
    );
  }
  verifyCommit(git, path, opts.commit, opts.tool);
  return {
    tool: opts.tool,
    action: 'checked_out',
    path,
    previousCommit: head,
    commit: opts.commit,
  };
}

function verifyCommit(
  git: GitRunner,
  dir: string,
  expected: string,
  tool: string,
): void {
  let actual: string;
  try {
    actual = git.revParse(dir);
  } catch (e) {
    throw new VendorError(
      `검증용 rev-parse 실패: ${dir} (${e instanceof Error ? e.message : String(e)})`,
      'REV_PARSE',
      tool,
    );
  }
  if (actual !== expected) {
    throw new VendorError(
      `SHA 불일치: 기대 ${expected}, 실제 ${actual}`,
      'SHA_MISMATCH',
      tool,
    );
  }
}
