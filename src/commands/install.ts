import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  readLock,
  seedLockTemplate,
  TOOL_NAMES,
  type HarnessLock,
  type ToolName,
} from '../core/lock.ts';
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
import { installGuardHook, HooksError, type HooksResult } from '../core/hooks.ts';

export type InstallErrorCode =
  | 'IN_PROGRESS'
  | 'SETTINGS_CONFLICT'
  | 'VENDOR'
  | 'SYMLINK'
  | 'GSTACK_SETUP'
  | 'HOOKS_WRITE'
  | 'SETTINGS_WRITE'
  | 'LOCK_SEEDED';

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

/**
 * Post-spawn artifact 검증 (§15 C5).
 * `defaultGstackSetup` 이 exit=0 만 보고 성공 보고하던 기존 동작에서
 * shell 파싱 에러·중도 실패 등이 silent-pass 로 흘러가던 문제 방지.
 * clone 시점에 존재해야 할 fingerprint 파일들이 post-setup 에도 살아있는지 확인한다.
 * (gstack 이 새로 만드는 artifact 는 프로젝트별로 다르므로,
 *  여기선 "setup 이 저장소를 쓸어버리지 않았는가" 수준의 기본 방어만 한다.)
 */
export function verifyGstackSetupArtifacts(gstackSource: string): void {
  const required = [
    join(gstackSource, 'setup'),
    join(gstackSource, 'SKILL.md'),
  ];
  const missing = required.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    throw new Error(
      `gstack setup 이 exit=0 을 반환했으나 기대 파일 누락: ${missing.join(', ')}. ` +
        `shell 파싱 에러 또는 setup 이 저장소를 손상시켰을 가능성. ` +
        `cd ${gstackSource} && ./setup --host auto 를 bash 로 직접 실행해 stderr 확인 권장.`,
    );
  }
}

/**
 * CLI 사용자용 기본 gstack setup 구현.
 * `<gstackSource>/setup --host auto` 를 spawn 하고 exit code 0 을 기대한다.
 * (DOGFOOD Round 1 §v0.1.1 #4: 기존에는 콜백 없이는 수동 `cd vendors/gstack && ./setup` 필요)
 * post-spawn 에 verifyGstackSetupArtifacts 를 호출해 silent-pass 를 차단한다 (§15 C5).
 */
export const defaultGstackSetup: GstackSetupFn = ({ gstackSource }) => {
  const script = join(gstackSource, 'setup');
  if (!existsSync(script)) {
    throw new Error(`gstack setup 스크립트 없음: ${script}`);
  }
  const res = spawnSync(script, ['--host', 'auto'], {
    cwd: gstackSource,
    stdio: 'inherit',
    // Windows: .sh 파일은 shell 경유 필요. Unix: 실행비트가 있으면 직접 spawn.
    shell: process.platform === 'win32',
  });
  if (res.error) throw res.error;
  if (typeof res.status === 'number' && res.status !== 0) {
    throw new Error(`gstack setup 비정상 종료 (exit=${res.status})`);
  }
  if (res.status === null) {
    throw new Error(`gstack setup 시그널 종료 (signal=${String(res.signal)})`);
  }
  verifyGstackSetupArtifacts(gstackSource);
};

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
  readonly hooks: HooksResult;
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
  const lockPath = opts.lockPath ?? `${harnessRoot}/harness.lock`;

  // pre-0. lock 부트스트랩 (§15 C1) — 빈 harness 에서 즉시 LOCK_NOT_FOUND 로
  // 실패하는 대신 패키지 동봉 템플릿을 시드하고 안내 메시지로 중단한다.
  // tx 시작 전에 수행 (이 실패는 기록할 phase 가 없음).
  const seedResult = seedLockTemplate(lockPath);
  if (seedResult.seeded) {
    throw new InstallError(
      `harness.lock 템플릿을 생성했습니다: ${lockPath}`,
      'LOCK_SEEDED',
      undefined,
      `각 tool 의 "commit" 을 실제 SHA 로 교체한 뒤 acorn install 재실행. ` +
        `현재 SHA 는 placeholder(40 zeros)라 vendor clone/checkout 에서 실패합니다.`,
    );
  }

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
  log(`[1/8] harness.lock 파싱`);
  tx.phase('lock');
  const lock = readLock(opts.lockPath);

  // 2. env 계산
  log(`[2/8] env 계산`);
  tx.phase('env');
  const desired = computeEnv(harnessRoot);
  const vRoot = vendorsRoot(harnessRoot);

  // 3. settings 충돌 체크 (읽기 전용, 조기 실패)
  log(`[3/8] settings.json preflight`);
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
  log(`[4/8] vendors clone/checkout`);
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
  log(`[5/8] gstack 심링크`);
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
    log(`[6/8] gstack setup (스킵)`);
  } else {
    log(`[6/8] gstack setup 실행`);
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

  // 7. hooks 배포 (ADR-017 / §15 C2) — settings.json 이 참조하는 artifact 를
  //    install 이 실제로 디스크에 만든다. gstack-setup 직후, settings-write 직전.
  log(`[7/8] hooks 배포`);
  tx.phase('hooks');
  let hooks: HooksResult;
  try {
    hooks = installGuardHook(harnessRoot);
    if (hooks.action === 'noop') {
      log(`      hooks: noop`);
    } else if (hooks.action === 'updated') {
      log(`      hooks: updated (backup: ${hooks.backup ?? '-'})`);
    } else {
      log(`      hooks: ${hooks.action} ${hooks.target}`);
    }
  } catch (e) {
    throw new InstallError(
      `hooks 배포 실패: ${e instanceof Error ? e.message : String(e)}`,
      'HOOKS_WRITE',
      e,
      e instanceof HooksError && e.code === 'SOURCE_MISSING'
        ? `패키지 무결성 문제로 보임. npm install 재실행 또는 배포본 재점검.`
        : `<harnessRoot>/hooks/ 디렉토리 권한 확인 후 재실행.`,
    );
  }

  // 8. settings 원자 쓰기 (백업 포함, 마지막)
  log(`[8/8] settings.json 쓰기`);
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
    hooks,
    settings,
  };
}
