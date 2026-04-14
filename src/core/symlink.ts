import {
  symlinkSync,
  lstatSync,
  readlinkSync,
  renameSync,
  unlinkSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export type SymlinkErrorCode = 'NOT_SYMLINK' | 'SOURCE_MISSING' | 'IO';

export class SymlinkError extends Error {
  readonly code: SymlinkErrorCode;
  readonly target: string;
  constructor(message: string, code: SymlinkErrorCode, target: string) {
    super(message);
    this.name = 'SymlinkError';
    this.code = code;
    this.target = target;
  }
}

export function defaultClaudeRoot(): string {
  return process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude');
}

export function defaultHarnessRoot(): string {
  return (
    process.env['ACORN_HARNESS_ROOT'] ??
    join(defaultClaudeRoot(), 'skills', 'harness')
  );
}

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
  return {
    target,
    status: resolved === expectedResolved ? 'correct' : 'wrong_target',
    currentLink: link,
    expectedSource,
  };
}

function symlinkType(): 'dir' | 'junction' | undefined {
  return platform() === 'win32' ? 'junction' : 'dir';
}

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
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw new SymlinkError(
      `rename 실패: ${tmp} → ${target} (${e instanceof Error ? e.message : String(e)})`,
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
}

export function ensureSymlink(source: string, target: string): EnsureResult {
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
      try {
        unlinkSync(target);
      } catch (e) {
        throw new SymlinkError(
          `기존 심링크 제거 실패: ${target} (${e instanceof Error ? e.message : String(e)})`,
          'IO',
          target,
        );
      }
      createDirSymlink(source, target);
      return { action: 'replaced', target, source, previousLink: prev };
    }
    case 'absent':
      createDirSymlink(source, target);
      return { action: 'created', target, source, previousLink: null };
  }
}

export interface InstallGstackOptions {
  readonly harnessRoot?: string;
  readonly claudeRoot?: string;
}

export function installGstackSymlink(opts: InstallGstackOptions = {}): EnsureResult {
  const source = gstackSymlinkSource(opts.harnessRoot);
  const target = gstackSymlinkPath(opts.claudeRoot);
  return ensureSymlink(source, target);
}
