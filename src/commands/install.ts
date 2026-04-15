import { readLock, TOOL_NAMES, type HarnessLock, type ToolName } from '../core/lock.ts';
import {
  computeEnv,
  defaultClaudeRoot,
  defaultHarnessRoot,
  vendorsRoot,
} from '../core/env.ts';
import {
  defaultSettingsPath,
  readSettings,
  planMerge,
  installEnv,
  SettingsError,
  type InstallEnvResult,
} from '../core/settings.ts';
import {
  installGstackSymlink,
  type EnsureResult,
} from '../core/symlink.ts';
import {
  installVendor,
  defaultGitRunner,
  VendorError,
  type GitRunner,
  type InstallVendorResult,
} from '../core/vendors.ts';
import { beginTx, lastInProgress } from '../core/tx.ts';

export type InstallErrorCode =
  | 'IN_PROGRESS'
  | 'SETTINGS_CONFLICT'
  | 'VENDOR'
  | 'SYMLINK'
  | 'GSTACK_SETUP'
  | 'SETTINGS_WRITE';

export class InstallError extends Error {
  readonly code: InstallErrorCode;
  readonly cause?: unknown;
  readonly hint?: string;
  constructor(message: string, code: InstallErrorCode, cause?: unknown, hint?: string) {
    super(message);
    this.name = 'InstallError';
    this.code = code;
    this.cause = cause;
    if (hint !== undefined) this.hint = hint;
  }
}

export type GstackSetupFn = (opts: {
  readonly gstackSource: string;
  readonly claudeRoot: string;
}) => void;

export interface InstallOptions {
  readonly lockPath?: string;
  readonly harnessRoot?: string;
  readonly claudeRoot?: string;
  readonly settingsPath?: string;
  readonly git?: GitRunner;
  readonly gstackSetup?: GstackSetupFn;
  readonly skipGstackSetup?: boolean;
  readonly logger?: (line: string) => void;
  /** Bypass in_progress tx.log guard. Use only after manual cleanup. */
  readonly force?: boolean;
}

export interface InstallResult {
  readonly lock: HarnessLock;
  readonly vendors: Readonly<Record<ToolName, InstallVendorResult>>;
  readonly gstackSymlink: EnsureResult;
  readonly gstackSetupRan: boolean;
  readonly settings: InstallEnvResult;
}

function noopLogger(): (_line: string) => void {
  return () => undefined;
}

/**
 * vendor 설치 실패 원인별 다음-행동 hint.
 * install 에러도 doctor 수준의 구체적 조치를 제공하기 위함 (DOGFOOD Round 1 §v0.1.1 #3).
 */
function vendorHint(name: ToolName, cause: unknown, vendorsRootPath: string): string | undefined {
  if (!(cause instanceof VendorError)) return undefined;
  const vPath = `${vendorsRootPath}/${name}`;
  switch (cause.code) {
    case 'NOT_A_REPO':
      return (
        `${vPath} 이 git 저장소가 아닙니다. ` +
        `수동 설치물이면 rm -rf ${vPath} 또는 mv ${vPath} ${vPath}.bak 후 재실행.`
      );
    case 'LOCAL_CHANGES':
      return (
        `${vPath} 에 커밋되지 않은 변경이 있습니다. ` +
        `git -C ${vPath} status 확인 후 커밋/stash 또는 restore 후 재실행.`
      );
    case 'CLONE':
      return `네트워크/권한 확인. 재시도: acorn install`;
    case 'CHECKOUT':
    case 'REV_PARSE':
      return `git -C ${vPath} fsck 로 저장소 무결성 확인.`;
    default:
      return undefined;
  }
}

export function runInstall(opts: InstallOptions = {}): InstallResult {
  const log = opts.logger ?? noopLogger();
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();
  const claudeRoot = opts.claudeRoot ?? defaultClaudeRoot();
  const settingsPath = opts.settingsPath ?? defaultSettingsPath();
  const git = opts.git ?? defaultGitRunner;

  // 0. tx.log 검사 — 이전 설치가 미완료(in_progress)면 fail-close
  const pending = lastInProgress(harnessRoot);
  if (pending && !opts.force) {
    throw new InstallError(
      `이전 설치 미완료 감지 (ts=${pending.ts}, phase=${pending.phase ?? 'begin'}). ` +
        `수동 검사 후 ${harnessRoot}/tx.log 정리 또는 --force 재실행 필요.`,
      'IN_PROGRESS',
      undefined,
      `상태 확인: cat ${harnessRoot}/tx.log | tail -20  •  문제 없으면: acorn install --force`,
    );
  }

  const tx = beginTx(harnessRoot);
  try {
    return runInstallInner({
      opts,
      log,
      harnessRoot,
      claudeRoot,
      settingsPath,
      git,
      tx,
    });
  } catch (e) {
    tx.abort(e instanceof Error ? e.message : String(e));
    throw e;
  }
}

interface InnerContext {
  readonly opts: InstallOptions;
  readonly log: (line: string) => void;
  readonly harnessRoot: string;
  readonly claudeRoot: string;
  readonly settingsPath: string;
  readonly git: GitRunner;
  readonly tx: ReturnType<typeof beginTx>;
}

function runInstallInner(ctx: InnerContext): InstallResult {
  const { opts, log, harnessRoot, claudeRoot, settingsPath, git, tx } = ctx;

  // 1. lock 파싱
  log(`[1/7] harness.lock 파싱`);
  tx.phase('lock');
  const lock = readLock(opts.lockPath);

  // 2. env 계산
  log(`[2/7] env 계산`);
  tx.phase('env');
  const desired = computeEnv(harnessRoot);
  const vRoot = vendorsRoot(harnessRoot);

  // 3. settings 충돌 체크 (읽기 전용, 조기 실패)
  log(`[3/7] settings.json preflight`);
  tx.phase('settings-preflight');
  const current = readSettings(settingsPath);
  const plan = planMerge(current, desired);
  if (plan.action === 'conflict') {
    const keys = plan.conflicts.map((c) => c.key).join(', ');
    throw new InstallError(
      `settings.json 에 env 키 충돌: ${plan.conflicts
        .map((c) => `${c.key} (현재="${c.current}", 기대="${c.desired}")`)
        .join('; ')}`,
      'SETTINGS_CONFLICT',
      undefined,
      `${settingsPath} 에서 env.${keys} 를 제거하거나 기대값으로 수정 후 재실행 ` +
        `(백업: ${settingsPath}.bak 은 install 단계에서 자동 생성)`,
    );
  }

  // 4. vendors clone
  log(`[4/7] vendors clone/checkout`);
  tx.phase('vendors');
  const vendors: Record<ToolName, InstallVendorResult> = {} as Record<
    ToolName,
    InstallVendorResult
  >;
  for (const name of TOOL_NAMES) {
    const tool = lock.tools[name];
    try {
      const r = installVendor({
        tool: name,
        repo: tool.repo,
        commit: tool.commit,
        vendorsRoot: vRoot,
        git,
      });
      vendors[name] = r;
      log(`      ${name}: ${r.action} (${r.commit.slice(0, 7)})`);
    } catch (e) {
      throw new InstallError(
        `vendor 설치 실패 (${name}): ${e instanceof Error ? e.message : String(e)}`,
        'VENDOR',
        e,
        vendorHint(name, e, vRoot),
      );
    }
  }

  // 5. gstack 심링크
  log(`[5/7] gstack 심링크`);
  tx.phase('symlink');
  let gstackSymlink: EnsureResult;
  try {
    gstackSymlink = installGstackSymlink({ harnessRoot, claudeRoot });
    log(`      ${gstackSymlink.action}: ${gstackSymlink.target}`);
  } catch (e) {
    throw new InstallError(
      `gstack 심링크 실패: ${e instanceof Error ? e.message : String(e)}`,
      'SYMLINK',
      e,
    );
  }

  // 6. gstack setup
  let gstackSetupRan = false;
  tx.phase('gstack-setup');
  if (opts.skipGstackSetup) {
    log(`[6/7] gstack setup (스킵)`);
  } else {
    log(`[6/7] gstack setup 실행`);
    try {
      const setupFn = opts.gstackSetup;
      if (setupFn) {
        setupFn({
          gstackSource: gstackSymlink.source,
          claudeRoot,
        });
        gstackSetupRan = true;
      } else {
        log(`      setup 콜백 미제공 — 수동으로 gstack setup 실행 필요`);
      }
    } catch (e) {
      throw new InstallError(
        `gstack setup 실행 실패: ${e instanceof Error ? e.message : String(e)}`,
        'GSTACK_SETUP',
        e,
      );
    }
  }

  // 7. settings 원자 쓰기 (백업 포함, 마지막)
  log(`[7/7] settings.json 쓰기`);
  tx.phase('settings-write');
  let settings: InstallEnvResult;
  try {
    settings = installEnv({
      settingsPath,
      harnessRoot,
      desired,
    });
    log(`      action=${settings.action} added=[${settings.added.join(', ')}]`);
  } catch (e) {
    if (e instanceof SettingsError && e.code === 'CONFLICT') {
      throw new InstallError(
        `settings.json 충돌 (preflight 이후 변경됨): ${e.message}`,
        'SETTINGS_CONFLICT',
        e,
        `${settingsPath} 가 preflight 이후 외부에서 수정됐습니다. ` +
          `충돌 env 키를 수정/제거 후 재실행.`,
      );
    }
    throw new InstallError(
      `settings.json 쓰기 실패: ${e instanceof Error ? e.message : String(e)}`,
      'SETTINGS_WRITE',
      e,
      `디스크 권한 / 파일시스템 확인 후 재실행. 백업: ${settingsPath}.bak`,
    );
  }

  tx.commit();
  return {
    lock,
    vendors,
    gstackSymlink,
    gstackSetupRan,
    settings,
  };
}
