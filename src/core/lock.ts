import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SCHEMA_VERSION = 1 as const;
export const TOOL_NAMES = ['omc', 'gstack', 'ecc'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const GUARD_MODES = ['block', 'warn', 'log'] as const;
export type GuardMode = (typeof GUARD_MODES)[number];

export const GUARD_PATTERNS = ['strict', 'moderate', 'minimal'] as const;
export type GuardPatterns = (typeof GUARD_PATTERNS)[number];

export interface ToolEntry {
  readonly repo: string;
  readonly commit: string;
  readonly verified_at: string;
}

export interface GuardConfig {
  readonly mode: GuardMode;
  readonly patterns: GuardPatterns;
}

export interface HarnessLock {
  readonly schema_version: 1;
  readonly acorn_version: string;
  readonly tools: Readonly<Record<ToolName, ToolEntry>>;
  readonly guard: GuardConfig;
}

export type LockErrorCode = 'NOT_FOUND' | 'PARSE' | 'SCHEMA' | 'IO';

export class LockError extends Error {
  readonly code: LockErrorCode;
  constructor(message: string, code: LockErrorCode) {
    super(message);
    this.name = 'LockError';
    this.code = code;
  }
}

export function defaultLockPath(harnessRoot?: string): string {
  const root =
    harnessRoot ??
    process.env['ACORN_HARNESS_ROOT'] ??
    join(homedir(), '.claude', 'skills', 'harness');
  return join(root, 'harness.lock');
}

const SHA1_RE = /^[a-f0-9]{40}$/i;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function validateToolEntry(tool: ToolName, raw: unknown): ToolEntry {
  if (!isObject(raw)) {
    throw new LockError(`tools.${tool}: object 가 아닙니다`, 'SCHEMA');
  }
  const { repo, commit, verified_at } = raw;
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) {
    throw new LockError(`tools.${tool}.repo: "owner/name" 형식이어야 합니다`, 'SCHEMA');
  }
  if (typeof commit !== 'string' || !SHA1_RE.test(commit)) {
    throw new LockError(`tools.${tool}.commit: 40자 SHA1 이어야 합니다`, 'SCHEMA');
  }
  if (typeof verified_at !== 'string' || !ISO_DATE_RE.test(verified_at)) {
    throw new LockError(`tools.${tool}.verified_at: YYYY-MM-DD 이어야 합니다`, 'SCHEMA');
  }
  return { repo, commit, verified_at };
}

function validateGuard(raw: unknown): GuardConfig {
  if (!isObject(raw)) {
    throw new LockError('guard: object 가 아닙니다', 'SCHEMA');
  }
  const { mode, patterns } = raw;
  if (typeof mode !== 'string' || !(GUARD_MODES as readonly string[]).includes(mode)) {
    throw new LockError(
      `guard.mode: ${GUARD_MODES.join('|')} 중 하나여야 합니다`,
      'SCHEMA',
    );
  }
  if (
    typeof patterns !== 'string' ||
    !(GUARD_PATTERNS as readonly string[]).includes(patterns)
  ) {
    throw new LockError(
      `guard.patterns: ${GUARD_PATTERNS.join('|')} 중 하나여야 합니다`,
      'SCHEMA',
    );
  }
  return { mode: mode as GuardMode, patterns: patterns as GuardPatterns };
}

export function parseLock(raw: string): HarnessLock {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new LockError(`JSON 파싱 실패: ${msg}`, 'PARSE');
  }

  if (!isObject(data)) {
    throw new LockError('루트가 object 가 아닙니다', 'SCHEMA');
  }

  const { schema_version, acorn_version, tools, guard } = data;

  if (schema_version !== SCHEMA_VERSION) {
    throw new LockError(
      `schema_version 불일치: 기대 ${SCHEMA_VERSION}, 실제 ${String(schema_version)}`,
      'SCHEMA',
    );
  }
  if (typeof acorn_version !== 'string' || acorn_version.length === 0) {
    throw new LockError('acorn_version: 비어있지 않은 문자열이어야 합니다', 'SCHEMA');
  }
  if (!isObject(tools)) {
    throw new LockError('tools: object 가 아닙니다', 'SCHEMA');
  }

  const validatedTools: Record<ToolName, ToolEntry> = {} as Record<ToolName, ToolEntry>;
  for (const name of TOOL_NAMES) {
    if (!(name in tools)) {
      throw new LockError(`tools.${name}: 누락`, 'SCHEMA');
    }
    validatedTools[name] = validateToolEntry(name, tools[name]);
  }

  return {
    schema_version: SCHEMA_VERSION,
    acorn_version,
    tools: validatedTools,
    guard: validateGuard(guard),
  };
}

export function readLock(lockPath?: string): HarnessLock {
  const path = lockPath ?? defaultLockPath();
  if (!existsSync(path)) {
    throw new LockError(`harness.lock 없음: ${path}`, 'NOT_FOUND');
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new LockError(`읽기 실패: ${path} (${msg})`, 'IO');
  }
  return parseLock(raw);
}

export function getTool(lock: HarnessLock, name: ToolName): ToolEntry {
  return lock.tools[name];
}
