import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  defaultLockPath,
  parseLock,
  parseLockV2,
  type AnyHarnessLock,
  type HarnessLock,
} from '../core/lock.ts';
import { defaultHarnessRoot } from '../core/env.ts';
import { backupDirTs, isoTsRaw } from '../core/time.ts';
import { stripBom } from '../core/bom.ts';
import { beginTx } from '../core/tx.ts';
import { AcornError } from '../core/errors.ts';
import {
  migrateV2toV3,
  renderMigrationPlan,
  MigrateError,
  type MigrationResult,
} from '../core/lock-migrate.ts';

/**
 * v0.9.6+: `acorn migrate` 오케스트레이터.
 *
 * 모드:
 * - dry-run (기본): plan + warning 만 출력. 디스크 변경 없음.
 * - --auto: backup → atomic write → migrations log 기록.
 *
 * 멱등성: lock 이 이미 v3 이면 NO_OP 반환 (에러 아님).
 * 안전성: 항상 backup 후 쓰기. backup 경로는 `<harnessRoot>/backup/<ts>/migrate/`.
 * 로그: `<harnessRoot>/migrations/v2-to-v3-<ts>.log` (JSONL).
 */

export type MigrateActionKind = 'plan' | 'noop' | 'migrated' | 'cancelled';

export interface PlanAction {
  readonly kind: 'plan';
  readonly result: MigrationResult;
  readonly lockPath: string;
}

export interface NoopAction {
  readonly kind: 'noop';
  readonly reason: 'already-v3';
  readonly lockPath: string;
}

export interface MigratedAction {
  readonly kind: 'migrated';
  readonly result: MigrationResult;
  readonly lockPath: string;
  readonly backupPath: string;
  readonly logPath: string;
}

export interface CancelledAction {
  readonly kind: 'cancelled';
  readonly reason: 'user-rejected';
}

export type MigrateAction =
  | PlanAction
  | NoopAction
  | MigratedAction
  | CancelledAction;

export type ConfirmFn = (prompt: string) => boolean;

export interface MigrateOptions {
  readonly lockPath?: string;
  readonly harnessRoot?: string;
  readonly auto?: boolean;
  readonly yes?: boolean;
  readonly confirm?: ConfirmFn;
  /** 마이그레이션 직후 lock 의 acorn_version 을 어떤 값으로 박을지. */
  readonly acornVersion?: string;
}

function readRawLock(lockPath: string): { raw: string; lock: AnyHarnessLock } {
  if (!existsSync(lockPath)) {
    throw new MigrateError(
      `harness.lock 을 찾을 수 없습니다: ${lockPath}`,
      'IO',
      'acorn install 로 v3 템플릿을 시드하거나 --lock-path 로 명시.',
    );
  }
  const raw = stripBom(readFileSync(lockPath, 'utf8'));
  const lock = parseLock(raw);
  return { raw, lock };
}

function backupLock(lockPath: string, harnessRoot: string): string {
  const ts = backupDirTs();
  const dir = join(harnessRoot, 'backup', ts, 'migrate');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${basename(lockPath)}.v2.bak`);
  copyFileSync(lockPath, dest);
  return dest;
}

function writeLockAtomic(lockPath: string, json: string): void {
  const dir = dirname(lockPath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${lockPath}.acorn-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, json, { encoding: 'utf8', mode: 0o644 });
    renameSync(tmp, lockPath);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw new MigrateError(
      `lock 쓰기 실패: ${lockPath} (${e instanceof Error ? e.message : String(e)})`,
      'IO',
    );
  }
}

function writeMigrationLog(
  harnessRoot: string,
  lockPath: string,
  v2: HarnessLock,
  result: MigrationResult,
  backupPath: string,
): string {
  const ts = backupDirTs();
  const dir = join(harnessRoot, 'migrations');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `v2-to-v3-${ts}.log`);
  const entry = {
    ts: isoTsRaw(),
    lockPath,
    backupPath,
    v2: {
      acorn_version: v2.acorn_version,
      schema_version: v2.schema_version,
      tools: Object.keys(v2.tools),
      optional_tools: Object.keys(v2.optional_tools),
      guard: v2.guard,
    },
    v3: {
      acorn_version: result.v3Lock.acorn_version,
      capabilities: Object.keys(result.v3Lock.capabilities),
      providers: Object.keys(result.v3Lock.providers),
      guard: result.v3Lock.guard,
    },
    preserved: result.preserved.map((p) => ({
      tool: p.tool,
      capabilities: p.capabilities,
    })),
    drops: result.drops,
    warnings: result.warnings,
  };
  writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o644,
  });
  return path;
}

function requireConfirm(prompt: string, opts: MigrateOptions): boolean {
  if (opts.yes) return true;
  if (!opts.confirm) {
    // non-TTY/CI 안전 — --yes 가 없으면 거절.
    throw new MigrateError(
      '확인 프롬프트 불가 (non-TTY 또는 CI). --yes 플래그로 명시 승인 필요.',
      'IO',
      'acorn migrate --auto --yes',
    );
  }
  return opts.confirm(prompt);
}

export function runMigrate(opts: MigrateOptions = {}): MigrateAction {
  const lockPath = opts.lockPath ?? defaultLockPath();
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();
  const { raw, lock } = readRawLock(lockPath);

  // 이미 v3 → no-op (에러 아님).
  if (lock.schema_version === 3) {
    return { kind: 'noop', reason: 'already-v3', lockPath };
  }

  // v2 (또는 v1) — parseLock 이 v1 도 v2 로 투명 마이그레이션해서 반환했음.
  // 이 시점의 lock 은 HarnessLock (v2). 확실히 하기 위해 parseLockV2 로 재검증.
  const v2 = parseLockV2(raw);
  const result = migrateV2toV3(v2, {
    ...(opts.acornVersion !== undefined ? { acornVersion: opts.acornVersion } : {}),
  });

  if (!opts.auto) {
    return { kind: 'plan', result, lockPath };
  }

  // --auto 경로: tx 로 감싸서 backup → write → log.
  const tx = beginTx(harnessRoot);
  try {
    tx.phase('migrate-prepare');
    const prompt =
      `harness.lock 을 v2 → v3 로 마이그레이션합니다 ` +
      `(${result.preserved.length} preserved, ${result.drops.length} dropped). ` +
      `진행하시겠습니까?`;
    if (!requireConfirm(prompt, opts)) {
      tx.commit();
      return { kind: 'cancelled', reason: 'user-rejected' };
    }
    tx.phase('migrate-backup');
    const backupPath = backupLock(lockPath, harnessRoot);
    tx.phase('migrate-write');
    writeLockAtomic(lockPath, `${JSON.stringify(result.v3Lock, null, 2)}\n`);
    tx.phase('migrate-log');
    const logPath = writeMigrationLog(harnessRoot, lockPath, v2, result, backupPath);
    tx.commit();
    return {
      kind: 'migrated',
      result,
      lockPath,
      backupPath,
      logPath,
    };
  } catch (e) {
    tx.abort(e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// ── rendering ────────────────────────────────────────────────────────────────

export function renderMigrateAction(a: MigrateAction): string {
  switch (a.kind) {
    case 'noop':
      return `= ${a.lockPath}: already v3 (no-op)`;
    case 'plan': {
      const lines: string[] = [renderMigrationPlan(a.result)];
      lines.push('');
      lines.push('이 plan 을 디스크에 적용하려면: `acorn migrate --auto --yes`');
      lines.push(`lock: ${a.lockPath}`);
      return lines.join('\n');
    }
    case 'migrated': {
      const lines: string[] = ['✅ migrate 완료: v2 → v3'];
      lines.push(`   lock:    ${a.lockPath}`);
      lines.push(`   backup:  ${a.backupPath}`);
      lines.push(`   log:     ${a.logPath}`);
      lines.push(renderMigrationPlan(a.result));
      return lines.join('\n');
    }
    case 'cancelled':
      return '취소됨: migrate (--yes 미사용 또는 사용자 거부)';
  }
}
