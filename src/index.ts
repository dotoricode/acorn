#!/usr/bin/env node
// acorn — Claude Code harness manager CLI router

import {
  runInstall,
  runGuidedInstall,
  renderGuidedReport,
  defaultGstackSetup,
  type InstallMode,
} from './commands/install.ts';
import { runUninstall } from './commands/uninstall.ts';
import {
  collectStatus,
  renderStatus,
  renderStatusJson,
  summarize,
} from './commands/status.ts';
import {
  runDoctor,
  renderDoctor,
  renderDoctorJson,
} from './commands/doctor.ts';
import {
  collectList,
  renderList,
  renderListJson,
  summarizeList,
} from './commands/list.ts';
import { readSync, readFileSync } from 'node:fs';
import { dirname, join as pathJoin } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLock, type HarnessLock } from './core/lock.ts';
import {
  runConfig,
  renderConfigAction,
  type ConfirmFn,
} from './commands/config.ts';
import { runPhase, renderPhaseAction } from './commands/phase.ts';
import { runPreset, renderPresetAction } from './commands/preset.ts';
import {
  runProviderList,
  runProviderAdd,
  renderProviderAction,
} from './commands/provider.ts';
import { runMigrate, renderMigrateAction } from './commands/migrate.ts';
import { VendorError } from './core/vendors.ts';
import { AcornError, formatAcornError } from './core/errors.ts';

/**
 * §15 v0.6.0: VERSION 을 package.json 에서 런타임 로드.
 * 이전엔 hardcode 문자열이라 릴리스 때마다 수동 동기화가 필요했고 v0.4.0+
 * 에서 실제로 '0.4.0' 에 머물러 있었다 (lock 은 독립적으로 acorn_version
 * 필드를 유지하지만 CLI `-V` 출력은 틀린 값). 이제 single source = package.json.
 */
function loadVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // dev (src/index.ts) 와 prod (dist/index.js) 둘 다 `<pkg>/..` 기준.
    const pkgPath = pathJoin(here, '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0-unknown';
  } catch {
    return '0.0.0-unknown';
  }
}

export const VERSION = loadVersion();

export interface CliIO {
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
}

const defaultIO: CliIO = {
  stdout: (l) => process.stdout.write(`${l}\n`),
  stderr: (l) => process.stderr.write(`${l}\n`),
};

export const EXIT = {
  OK: 0,
  FAILURE: 1,
  USAGE: 64,
  CONFIG: 78, // EX_CONFIG (settings conflict, lock schema 등)
  IN_PROGRESS: 75, // EX_TEMPFAIL 재시도 가능
} as const;

export function usage(): string {
  return `acorn v${VERSION} — Claude Code harness manager

사용법:
  acorn <command> [flags]

Commands:
  install        harness.lock 기준으로 OMC/gstack/ECC 설치 + env 주입
  uninstall      harness 전체 제거 (vendors / symlink / env / hooks / CLAUDE.md 마커) (v0.9.0+)
  status         현재 설치 상태 요약 (read-only)
  list           lock 기준 tool 목록 + SHA + 상태 (read-only, v0.6.0+)
  doctor         진단 + 권장 조치
  lock validate  harness.lock schema 검증 (read-only, CI 친화)
  config         guard.mode / guard.patterns / env.reset 조작 (v0.3.0+)
  phase          현재 phase 조회 / 변경 (prototype|dev|production) (v0.7.0+)
  preset         현재 preset 조회 / 변경 (starter|builder|frontend|backend) (v0.10.0+)
  provider       사용자 정의 provider 레지스트리 (list / add) (v0.9.5+)
  migrate        v2 → v3 lock 자동 마이그레이션 (--auto / --yes) (v0.9.6+)

Global flags:
  -h, --help      도움말
  -V, --version   버전 출력
  --json          JSON 출력 (status, list, doctor)

install flags:
  --force              이전 tx.log in_progress 우회
  --skip-gstack-setup  gstack setup 콜백 생략
  --run-gstack-setup   <vendors/gstack>/setup --host auto 를 자동 실행
                       (--skip-gstack-setup 과 상호 배타)
  --adopt              기존 non-git vendor 를 "<path>.pre-adopt-<ISO8601>" 로
                       rename 한 뒤 lock SHA 기준으로 clone (destructive rename,
                       Y/n 확인 — non-TTY 는 --yes 필요)
  --follow-symlink     vendor 경로가 심링크면 target HEAD 를 lock SHA 와 비교
                       (기본: 심링크 거부)
  --yes                확인 프롬프트 스킵 (destructive 플래그용)

config 서브커맨드:
  acorn config                        현재 설정 요약 (guard.mode / patterns)
  acorn config <key>                  key 의 현재 값 출력 (get)
  acorn config guard.mode <block|warn|log>
                                      guard 훅 동작 모드 변경
  acorn config guard.patterns <strict|moderate|minimal>
                                      차단 패턴 세트 변경
  acorn config env.reset              settings.json 에서 env 3키
                                      (CLAUDE_PLUGIN_ROOT / OMC_PLUGIN_ROOT /
                                       ECC_ROOT) 만 제거 — 다른 키 보존
  config flags:
    --yes              Y/n 확인 프롬프트 스킵 (non-TTY/CI 에서 필수)

phase 서브커맨드:
  acorn phase                         현재 phase 조회
  acorn phase <prototype|dev|production>  phase 변경 (Y/n 확인)
  acorn phase <value> --yes           확인 프롬프트 스킵

provider 서브커맨드 (v0.9.5+):
  acorn provider list                 builtin + env + 사용자 파일 통합 목록
  acorn provider add <path>           <path> 의 *.json 을 검증 후
                                      <harnessRoot>/providers/<name>.json 으로 복사
  acorn provider add <path> --force   같은 이름이 이미 있으면 덮어쓰기

migrate 플래그 (v0.9.6+):
  acorn migrate                       v2 → v3 plan 출력 (dry-run, 변경 없음)
  acorn migrate --auto --yes          backup 후 v3 으로 atomic 쓰기 + log 기록
                                      log: <harnessRoot>/migrations/v2-to-v3-<ts>.log

config provider 키 (v0.9.5+):
  acorn config provider.allow-custom              현재 정책 조회
  acorn config provider.allow-custom <true|false> 사용자 정의 provider 의
                                                  install_cmd 실행 허용 여부 (기본 false)

uninstall flags:
  --yes              타이핑 확인 프롬프트 스킵 (non-TTY/CI 에서 필수)

예시:
  acorn install
  acorn install --run-gstack-setup
  acorn install --adopt --yes
  acorn uninstall --yes
  acorn status --json
  acorn list
  acorn list --json
  acorn doctor
  acorn config guard.mode warn --yes
  acorn config env.reset --yes
  acorn phase
  acorn phase production --yes
`;
}

interface ParsedArgs {
  readonly flags: Set<string>;
  readonly positional: readonly string[];
  readonly values: ReadonlyMap<string, string>;
}

function parseArgs(args: readonly string[]): ParsedArgs {
  const flags = new Set<string>();
  const positional: string[] = [];
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a) continue;
    if (a === '--') {
      positional.push(...args.slice(i + 1).filter((x): x is string => typeof x === 'string'));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        values.set(a.slice(2, eq), a.slice(eq + 1));
      } else {
        flags.add(a.slice(2));
      }
    } else if (a.startsWith('-') && a.length > 1) {
      flags.add(a.slice(1));
    } else {
      positional.push(a);
    }
  }
  return { flags, positional, values };
}

/**
 * v0.9.4+: 모든 명시적 acorn 에러는 AcornError 베이스를 상속하므로
 * 단일 분기로 [namespace/CODE] 헤더 + Hint:/See: 라인을 생성한다.
 * VendorError 처럼 namespace 외 추가 식별자(tool)가 있는 경우만 별도 분기.
 */
function formatError(e: unknown): string {
  if (e instanceof VendorError) {
    // 헤더에 tool 을 포함시켜 기존 출력 형식 유지: [vendor/CODE/tool]
    const head = `[vendor/${e.code}/${e.tool}] ${e.message}`;
    const lines: string[] = [head];
    if (e.hint) lines.push(`   Hint: ${e.hint}`);
    if (e.docsUrl) lines.push(`   See:  ${e.docsUrl}`);
    return lines.join('\n');
  }
  if (e instanceof AcornError) return formatAcornError(e);
  if (e instanceof Error) return e.message;
  return String(e);
}

/**
 * v0.9.4+: AcornError 의 namespace+code 조합으로 exit code 매핑.
 * 매핑은 한 곳에 모아 두기 — 새 namespace/code 가 생기면 여기만 갱신.
 *
 * §15 v0.4.3 Round 3 F1: lock SCHEMA/PARSE 는 CONFIG (파일 손상은 사용자 config 문제).
 * NOT_FOUND/IO 는 인프라 이슈로 FAILURE 유지.
 */
function exitFor(e: unknown): number {
  if (!(e instanceof AcornError)) return EXIT.FAILURE;
  const ns = e.namespace;
  const c = e.code;
  if (ns === 'install') {
    if (c === 'IN_PROGRESS') return EXIT.IN_PROGRESS;
    if (c === 'SETTINGS_CONFLICT') return EXIT.CONFIG;
  }
  if (ns === 'lock' && (c === 'SCHEMA' || c === 'PARSE')) return EXIT.CONFIG;
  if (ns === 'config') {
    if (c === 'SCHEMA' || c === 'UNKNOWN_KEY') return EXIT.CONFIG;
    if (c === 'CONFIRM_REQUIRED') return EXIT.USAGE;
  }
  if (ns === 'phase') {
    if (c === 'INVALID_VALUE') return EXIT.CONFIG;
    if (c === 'CONFIRM_REQUIRED') return EXIT.USAGE;
  }
  if (ns === 'preset') {
    if (c === 'INVALID_VALUE') return EXIT.CONFIG;
    if (c === 'CONFIRM_REQUIRED') return EXIT.USAGE;
  }
  if (ns === 'provider') {
    // v0.9.5+: PARSE/SCHEMA = lock-style → CONFIG, IO = 사용자 환경/입력 → USAGE,
    // CUSTOM_BLOCKED = 정책 위반 → CONFIG (의도적 거부)
    if (c === 'PARSE' || c === 'SCHEMA' || c === 'CUSTOM_BLOCKED') return EXIT.CONFIG;
    if (c === 'IO') return EXIT.USAGE;
  }
  if (ns === 'migrate') {
    // v0.9.6+: NOT_V2 = 이미 v3 (정상 no-op 가 별도 케이스라 사실상 도달 안 함),
    // SCHEMA = 손상 lock → CONFIG, IO = 사용자 환경 (TTY 부재 / 경로 누락) → USAGE.
    if (c === 'SCHEMA' || c === 'NOT_V2') return EXIT.CONFIG;
    if (c === 'IO') return EXIT.USAGE;
  }
  return EXIT.FAILURE;
}

function cmdInstall(parsed: ParsedArgs, io: CliIO): number {
  try {
    const rawModeArg = parsed.values.get('mode');
    // v0.9.1+: `normal` → `auto` 리네임. 호환성 위해 둘 다 받음.
    if (rawModeArg === 'normal') {
      io.stderr(`[install] --mode normal 은 deprecated 입니다. --mode auto 를 사용하세요.`);
    }
    const modeArg = rawModeArg === 'normal' ? 'auto' : (rawModeArg as InstallMode | undefined);
    if (modeArg === 'guided' || modeArg === 'detect-only') {
      const report = runGuidedInstall({ mode: modeArg });
      io.stdout(renderGuidedReport(report));
      return EXIT.OK;
    }
    if (modeArg !== undefined && modeArg !== 'auto') {
      io.stderr(`[install/ARGS] --mode 값이 잘못되었습니다: "${rawModeArg}". 허용값: auto, guided, detect-only`);
      return EXIT.USAGE;
    }

    const runSetup = parsed.flags.has('run-gstack-setup');
    const skipSetup = parsed.flags.has('skip-gstack-setup');
    if (runSetup && skipSetup) {
      io.stderr(
        `[install/ARGS] --run-gstack-setup 와 --skip-gstack-setup 는 동시에 지정할 수 없습니다.`,
      );
      return EXIT.FAILURE;
    }
    // §15 B3 (v0.3.1): --adopt 는 vendor 디렉토리를 `<path>.pre-adopt-<ISO8601>`
    // 로 rename 하는 destructive op. uninstall 보다 gate 가 약했던 회귀를 차단.
    const adopt = parsed.flags.has('adopt');
    const yes = parsed.flags.has('yes');
    if (adopt && !yes) {
      const isTty = Boolean(process.stdout.isTTY && process.stdin.isTTY);
      if (!isTty) {
        io.stderr(
          `[install/ARGS] --adopt 는 destructive rename 입니다. ` +
            `non-TTY 환경에선 --yes 명시적 승인 필요.`,
        );
        return EXIT.USAGE;
      }
      io.stdout(
        `⚠️  --adopt: 기존 non-git vendor 디렉토리를 ` +
          `"<path>.pre-adopt-<ISO8601>" 로 이름 변경 후 lock SHA 기준으로 clone 합니다.`,
      );
      io.stdout(`계속하시겠습니까? [Y/n]`);
      const buf = Buffer.alloc(8);
      let accepted = false;
      try {
        const n = readSync(0, buf, 0, buf.length, null);
        const input = buf.slice(0, n).toString('utf8').trim().toLowerCase();
        accepted = input === '' || input.startsWith('y');
      } catch {
        accepted = false;
      }
      if (!accepted) {
        io.stdout(`취소됨: --adopt`);
        return EXIT.OK;
      }
    }
    const r = runInstall({
      logger: (l) => io.stdout(l),
      force: parsed.flags.has('force'),
      skipGstackSetup: skipSetup,
      adopt,
      followSymlink: parsed.flags.has('follow-symlink'),
      ...(runSetup ? { gstackSetup: defaultGstackSetup } : {}),
    });
    io.stdout('');
    io.stdout(`✅ 설치 완료`);
    const providersSummary = r.v3Providers !== undefined
      ? r.v3Providers.map((p) => `${p.provider}=${p.action}`).join(' ')
      : Object.values(r.vendors).map((v) => `${v.tool}=${v.action}`).join(' ');
    io.stdout(`   settings: ${r.settings.action}  hooks: ${r.hooks.action}  providers: ${providersSummary}`);
    // §15 H-1 (v0.3.4): silent no-op 방지 — setup 이 필요했지만 콜백 미제공으로
    // 안 돌았을 때만 경고. marker-noop / skip-flag / ran 은 모두 의도된 상태.
    if (r.gstackSetupReason === 'no-callback') {
      io.stderr('');
      io.stderr(
        `⚠️  gstack setup 이 실행되지 않았습니다 (콜백 미제공 + marker 불일치).`,
      );
      io.stderr(
        `   조치: --run-gstack-setup 으로 재실행 하거나, ` +
          `--skip-gstack-setup 으로 의도 명시, ` +
          `또는 수동 실행 후 다음 install 에서 marker 기록.`,
      );
    }
    return EXIT.OK;
  } catch (e) {
    io.stderr(formatError(e));
    return exitFor(e);
  }
}

function cmdUninstall(parsed: ParsedArgs, io: CliIO): number {
  const yes = parsed.flags.has('yes');
  const isTty = Boolean(process.stdout.isTTY && process.stdin.isTTY);

  if (!yes) {
    if (!isTty) {
      io.stderr(
        `[uninstall/CONFIRM_REQUIRED] uninstall 은 destructive 작업입니다. ` +
          `non-TTY 환경에서는 --yes 명시 필요.`,
      );
      return EXIT.USAGE;
    }
    io.stdout(`⚠️  acorn uninstall 은 harness 를 완전히 제거합니다:`);
    io.stdout(`   • vendors/ 디렉토리 삭제`);
    io.stdout(`   • gstack 심링크 제거`);
    io.stdout(`   • settings.json env 키 제거`);
    io.stdout(`   • CLAUDE.md phase 마커 제거`);
    io.stdout(`   • hooks / phase.txt / gstack marker 제거`);
    io.stdout(``);
    io.stdout(`확인하려면 'uninstall' 을 입력하세요 (취소: Enter):`);
    const buf = Buffer.alloc(32);
    let confirmed = false;
    try {
      const n = readSync(0, buf, 0, buf.length, null);
      const input = buf.slice(0, n).toString('utf8').trim();
      confirmed = input === 'uninstall';
    } catch {
      confirmed = false;
    }
    if (!confirmed) {
      io.stdout(`취소됨: uninstall`);
      return EXIT.OK;
    }
  }

  try {
    const r = runUninstall({ logger: (l) => io.stdout(l) });
    io.stdout(``);
    io.stdout(`✅ uninstall 완료`);
    io.stdout(
      `   settings=[${r.settingsRemoved.join(', ') || '없음'}]` +
        `  claudeMd=${r.claudeMd.kind}` +
        `  symlink=${r.symlink}` +
        `  vendors=${r.vendorsRemoved ? 'removed' : 'absent'}`,
    );
    return EXIT.OK;
  } catch (e) {
    io.stderr(formatError(e));
    return exitFor(e);
  }
}

function cmdStatus(parsed: ParsedArgs, io: CliIO): number {
  try {
    // §15 M3: CLI 진입 시 process.env 를 명시 전달해 runtime env check 활성.
    const r = collectStatus({ runtimeEnv: process.env });
    if (parsed.flags.has('json')) {
      io.stdout(renderStatusJson(r));
    } else {
      io.stdout(renderStatus(r));
    }
    return summarize(r).ok ? EXIT.OK : EXIT.FAILURE;
  } catch (e) {
    io.stderr(formatError(e));
    return exitFor(e);
  }
}

function cmdList(parsed: ParsedArgs, io: CliIO): number {
  try {
    const r = collectList();
    if (parsed.flags.has('json')) {
      io.stdout(renderListJson(r));
    } else {
      io.stdout(renderList(r));
    }
    return summarizeList(r).ok ? EXIT.OK : EXIT.FAILURE;
  } catch (e) {
    io.stderr(formatError(e));
    return exitFor(e);
  }
}

function cmdDoctor(parsed: ParsedArgs, io: CliIO): number {
  try {
    // §15 M3: doctor 도 runtime env check 활성.
    // v0.9.3+: --skip-npm-version-check 로 npm 비교를 끌 수 있음 (오프라인 / CI 속도).
    const r = runDoctor({
      runtimeEnv: process.env,
      skipNpmVersionCheck: parsed.flags.has('skip-npm-version-check'),
    });
    if (parsed.flags.has('json')) {
      io.stdout(renderDoctorJson(r));
    } else {
      io.stdout(renderDoctor(r));
    }
    return r.ok ? EXIT.OK : EXIT.FAILURE;
  } catch (e) {
    io.stderr(formatError(e));
    return exitFor(e);
  }
}

export function runCli(argv: readonly string[], io: CliIO = defaultIO): number {
  if (argv.length === 0) {
    io.stdout(usage());
    return EXIT.OK;
  }
  const [head, ...rest] = argv;
  if (head === '-h' || head === '--help') {
    io.stdout(usage());
    return EXIT.OK;
  }
  if (head === '-V' || head === '--version') {
    io.stdout(VERSION);
    return EXIT.OK;
  }
  const parsed = parseArgs(rest);
  switch (head) {
    case 'install':
      return cmdInstall(parsed, io);
    case 'uninstall':
      return cmdUninstall(parsed, io);
    case 'status':
      return cmdStatus(parsed, io);
    case 'list':
      return cmdList(parsed, io);
    case 'doctor':
      return cmdDoctor(parsed, io);
    case 'lock':
      return cmdLock(rest, io);
    case 'config':
      return cmdConfig(rest, io);
    case 'phase':
      return cmdPhase(rest, io);
    case 'preset':
      return cmdPreset(rest, io);
    case 'provider':
      return cmdProvider(rest, io);
    case 'migrate':
      return cmdMigrate(rest, io);
    default:
      io.stderr(`알 수 없는 커맨드: ${head}`);
      io.stderr('');
      io.stderr(usage());
      return EXIT.USAGE;
  }
}

/**
 * §15 v0.2.0 S5 — `acorn lock <sub>` subcommand router.
 * 현재 subcommand: validate
 */
function cmdLock(rest: readonly string[], io: CliIO): number {
  const [sub, ...subRest] = rest;
  if (!sub || sub === '-h' || sub === '--help') {
    io.stdout('사용법: acorn lock <validate> [lockPath]');
    io.stdout('');
    io.stdout('서브커맨드:');
    io.stdout('  validate [path]   harness.lock schema 검증. 기본 경로는 defaultLockPath().');
    return sub ? EXIT.OK : EXIT.USAGE;
  }
  switch (sub) {
    case 'validate':
      return cmdLockValidate(subRest, io);
    default:
      io.stderr(`알 수 없는 lock 서브커맨드: ${sub}`);
      return EXIT.USAGE;
  }
}

function cmdLockValidate(args: readonly string[], io: CliIO): number {
  const lockPath = args[0];
  try {
    const lock = readLock(lockPath);
    const itemCount = lock.schema_version === 3
      ? `providers=${Object.keys((lock as import('./core/lock.ts').HarnessLockV3).providers).length}`
      : `tools=${Object.keys((lock as HarnessLock).tools).length}`;
    io.stdout(
      `✅ harness.lock OK  ` +
        `(schema_version=${lock.schema_version}, ` +
        `acorn_version=${lock.acorn_version}, ` +
        `${itemCount}, ` +
        `guard=${lock.guard.mode}/${lock.guard.patterns})`,
    );
    return EXIT.OK;
  } catch (e) {
    io.stderr(formatError(e));
    return exitFor(e);
  }
}

function cmdPhase(rest: readonly string[], io: CliIO): number {
  const parsed = parseArgs(rest);
  const value = parsed.positional[0];
  const yes = parsed.flags.has('yes');
  try {
    const isTty = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    const confirmFn: ConfirmFn = (prompt) => {
      io.stdout(`${prompt} [Y/n]`);
      const buf = Buffer.alloc(8);
      try {
        const n = readSync(0, buf, 0, buf.length, null);
        const input = buf.slice(0, n).toString('utf8').trim().toLowerCase();
        return input === '' || input.startsWith('y');
      } catch {
        return false;
      }
    };
    const action = runPhase(value, isTty ? { yes, confirm: confirmFn } : { yes });
    io.stdout(renderPhaseAction(action));
    return EXIT.OK;
  } catch (e) {
    io.stderr(formatError(e));
    return exitFor(e);
  }
}

/**
 * v0.9.6+: `acorn migrate [--auto] [--yes] [--lock-path PATH]`.
 * 기본은 dry-run — plan 만 출력. --auto 면 backup → atomic write → log.
 */
function cmdMigrate(rest: readonly string[], io: CliIO): number {
  const parsed = parseArgs(rest);
  if (parsed.flags.has('h') || parsed.flags.has('help')) {
    io.stdout('사용법: acorn migrate [--auto] [--yes] [--lock-path PATH]');
    io.stdout('');
    io.stdout('  (기본) dry-run: v2 → v3 plan 만 출력, 디스크 변경 없음');
    io.stdout('  --auto       backup 후 v3 으로 atomic 쓰기 + migrations log');
    io.stdout('  --yes        Y/n 확인 프롬프트 스킵 (non-TTY/CI 에서 필수)');
    return EXIT.OK;
  }
  try {
    const isTty = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    const confirmFn: ConfirmFn = (prompt) => {
      io.stdout(`${prompt} [Y/n]`);
      const buf = Buffer.alloc(8);
      try {
        const n = readSync(0, buf, 0, buf.length, null);
        const input = buf.slice(0, n).toString('utf8').trim().toLowerCase();
        return input === '' || input.startsWith('y');
      } catch {
        return false;
      }
    };
    const lockPath = parsed.values.get('lock-path');
    const action = runMigrate({
      auto: parsed.flags.has('auto'),
      yes: parsed.flags.has('yes'),
      ...(lockPath !== undefined ? { lockPath } : {}),
      ...(isTty ? { confirm: confirmFn } : {}),
    });
    io.stdout(renderMigrateAction(action));
    return EXIT.OK;
  } catch (e) {
    io.stderr(formatError(e));
    return exitFor(e);
  }
}

/**
 * v0.9.5+: `acorn provider <list|add>`.
 * list   = read-only, builtin/env/user-file 통합 + warning 표시
 * add    = 검증 후 <harnessRoot>/providers/<name>.json 으로 복사
 */
function cmdProvider(rest: readonly string[], io: CliIO): number {
  const [sub, ...subRest] = rest;
  if (!sub || sub === '-h' || sub === '--help') {
    io.stdout('사용법: acorn provider <list|add> [args]');
    io.stdout('');
    io.stdout('서브커맨드:');
    io.stdout('  list                builtin + env + 사용자 파일 통합 목록');
    io.stdout('  add <path> [--force] *.json 검증 후 providers/ 로 복사');
    return sub ? EXIT.OK : EXIT.USAGE;
  }
  try {
    if (sub === 'list') {
      const action = runProviderList();
      io.stdout(renderProviderAction(action));
      return EXIT.OK;
    }
    if (sub === 'add') {
      const parsed = parseArgs(subRest);
      const inputPath = parsed.positional[0];
      const action = runProviderAdd(inputPath, { force: parsed.flags.has('force') });
      io.stdout(renderProviderAction(action));
      return EXIT.OK;
    }
    io.stderr(`알 수 없는 provider 서브커맨드: ${sub}`);
    return EXIT.USAGE;
  } catch (e) {
    io.stderr(formatError(e));
    return exitFor(e);
  }
}

function cmdPreset(rest: readonly string[], io: CliIO): number {
  const parsed = parseArgs(rest);
  const value = parsed.positional[0];
  const yes = parsed.flags.has('yes');
  try {
    const isTty = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    const confirmFn: ConfirmFn = (prompt) => {
      io.stdout(`${prompt} [Y/n]`);
      const buf = Buffer.alloc(8);
      try {
        const n = readSync(0, buf, 0, buf.length, null);
        const input = buf.slice(0, n).toString('utf8').trim().toLowerCase();
        return input === '' || input.startsWith('y');
      } catch {
        return false;
      }
    };
    const action = runPreset(value, isTty ? { yes, confirm: confirmFn } : { yes });
    io.stdout(renderPresetAction(action));
    return EXIT.OK;
  } catch (e) {
    io.stderr(formatError(e));
    return exitFor(e);
  }
}

/**
 * §15 v0.3.0 S3 — `acorn config [key] [value]`.
 * key 미지정 → 현재 설정 요약.
 * value 미지정 → key 의 현재 값 반환 (get).
 * key+value 지정 → 쓰기 (set). 기본은 Y/n 프롬프트, --yes 로 스킵.
 */
function cmdConfig(rest: readonly string[], io: CliIO): number {
  const parsed = parseArgs(rest);
  const [key, value] = parsed.positional;
  try {
    const isTty = Boolean(process.stdout.isTTY && process.stdin.isTTY);
    const confirmFn: ConfirmFn = (prompt) => {
      io.stdout(`${prompt} [Y/n]`);
      const buf = Buffer.alloc(8);
      try {
        const n = readSync(0, buf, 0, buf.length, null);
        const input = buf.slice(0, n).toString('utf8').trim().toLowerCase();
        return input === '' || input.startsWith('y');
      } catch {
        // TTY 이지만 read 실패 — 안전하게 거절
        return false;
      }
    };

    const runOpts = isTty
      ? { yes: parsed.flags.has('yes'), confirm: confirmFn }
      : { yes: parsed.flags.has('yes') };
    const action = runConfig(key, value, runOpts);
    io.stdout(renderConfigAction(action));
    return EXIT.OK;
  } catch (e) {
    io.stderr(formatError(e));
    return exitFor(e);
  }
}

// ESM entrypoint: 직접 실행될 때만 process.exit
// Windows 경로/심링크 환경에서도 일치시키기 위해 realpath 해석 후 pathToFileURL 로 정규화
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
function sameFile(a: string, b: string): boolean {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}
const isMain =
  typeof process.argv[1] === 'string' &&
  sameFile(fileURLToPath(import.meta.url), process.argv[1]);

if (isMain) {
  const code = runCli(process.argv.slice(2));
  process.exit(code);
}
