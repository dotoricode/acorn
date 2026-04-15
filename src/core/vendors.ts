import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export type VendorErrorCode =
  | 'GIT_MISSING'
  | 'CLONE'
  | 'CHECKOUT'
  | 'REV_PARSE'
  | 'NOT_A_REPO'
  | 'SHA_MISMATCH'
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
}

export function defaultVendorsRoot(harnessRoot?: string): string {
  const root =
    harnessRoot ??
    process.env['ACORN_HARNESS_ROOT'] ??
    join(homedir(), '.claude', 'skills', 'harness');
  return join(root, 'vendors');
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
    }).toString();
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer | string };
    const stderr =
      typeof err.stderr === 'string'
        ? err.stderr
        : err.stderr?.toString('utf8') ?? '';
    const detail = stderr.trim() || err.message;
    throw new Error(`${cmd} ${args.join(' ')}: ${detail}`);
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
};

export type VendorAction = 'noop' | 'cloned' | 'checked_out';

export interface InstallVendorOptions {
  readonly tool: string;
  readonly repo: string;
  readonly commit: string;
  readonly vendorsRoot: string;
  readonly git?: GitRunner;
}

export interface InstallVendorResult {
  readonly tool: string;
  readonly action: VendorAction;
  readonly path: string;
  readonly previousCommit: string | null;
  readonly commit: string;
}

function isEmptyDir(dir: string): boolean {
  if (!existsSync(dir)) return true;
  try {
    return readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}

export function installVendor(opts: InstallVendorOptions): InstallVendorResult {
  const git = opts.git ?? defaultGitRunner;
  const path = join(opts.vendorsRoot, opts.tool);
  mkdirSync(opts.vendorsRoot, { recursive: true });

  if (!existsSync(path) || isEmptyDir(path)) {
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
      throw new VendorError(
        `clone 실패: ${opts.repo} → ${path} (${e instanceof Error ? e.message : String(e)})`,
        'CLONE',
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
      action: 'cloned',
      path,
      previousCommit: null,
      commit: opts.commit,
    };
  }

  if (!git.isGitRepo(path)) {
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
