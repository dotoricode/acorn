import { readLock, TOOL_NAMES, type HarnessLock, type ToolName } from '../core/lock.ts';
import { computeEnv, defaultHarnessRoot, vendorsRoot } from '../core/env.ts';
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
  defaultClaudeRoot,
  type EnsureResult,
} from '../core/symlink.ts';
import {
  installVendor,
  defaultGitRunner,
  type GitRunner,
  type InstallVendorResult,
} from '../core/vendors.ts';

export type InstallErrorCode =
  | 'SETTINGS_CONFLICT'
  | 'VENDOR'
  | 'SYMLINK'
  | 'GSTACK_SETUP'
  | 'SETTINGS_WRITE';

export class InstallError extends Error {
  readonly code: InstallErrorCode;
  readonly cause?: unknown;
  constructor(message: string, code: InstallErrorCode, cause?: unknown) {
    super(message);
    this.name = 'InstallError';
    this.code = code;
    this.cause = cause;
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

export function runInstall(opts: InstallOptions = {}): InstallResult {
  const log = opts.logger ?? noopLogger();
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();
  const claudeRoot = opts.claudeRoot ?? defaultClaudeRoot();
  const settingsPath = opts.settingsPath ?? defaultSettingsPath();
  const git = opts.git ?? defaultGitRunner;

  // 1. lock 파싱
  log(`[1/7] harness.lock 파싱`);
  const lock = readLock(opts.lockPath);

  // 2. env 계산
  log(`[2/7] env 계산`);
  const desired = computeEnv(harnessRoot);
  const vRoot = vendorsRoot(harnessRoot);

  // 3. settings 충돌 체크 (읽기 전용, 조기 실패)
  log(`[3/7] settings.json preflight`);
  const current = readSettings(settingsPath);
  const plan = planMerge(current, desired);
  if (plan.action === 'conflict') {
    throw new InstallError(
      `settings.json 에 env 키 충돌: ${plan.conflicts
        .map((c) => `${c.key} (현재="${c.current}", 기대="${c.desired}")`)
        .join('; ')}`,
      'SETTINGS_CONFLICT',
    );
  }

  // 4. vendors clone
  log(`[4/7] vendors clone/checkout`);
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
      );
    }
  }

  // 5. gstack 심링크
  log(`[5/7] gstack 심링크`);
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
      );
    }
    throw new InstallError(
      `settings.json 쓰기 실패: ${e instanceof Error ? e.message : String(e)}`,
      'SETTINGS_WRITE',
      e,
    );
  }

  return {
    lock,
    vendors,
    gstackSymlink,
    gstackSetupRan,
    settings,
  };
}
