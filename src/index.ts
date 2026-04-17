#!/usr/bin/env node
// acorn — Claude Code harness manager CLI router

import { runInstall, InstallError, defaultGstackSetup } from './commands/install.ts';
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
import { LockError, readLock } from './core/lock.ts';
import { VendorError } from './core/vendors.ts';
import { SettingsError } from './core/settings.ts';
import { SymlinkError } from './core/symlink.ts';

export const VERSION = '0.2.0';

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
  status         현재 설치 상태 요약 (read-only)
  doctor         진단 + 권장 조치
  lock validate  harness.lock schema 검증 (read-only, CI 친화)

Global flags:
  -h, --help      도움말
  -V, --version   버전 출력
  --json          JSON 출력 (status, doctor)

install flags:
  --force              이전 tx.log in_progress 우회
  --skip-gstack-setup  gstack setup 콜백 생략
  --run-gstack-setup   <vendors/gstack>/setup --host auto 를 자동 실행
                       (--skip-gstack-setup 과 상호 배타)

예시:
  acorn install
  acorn install --run-gstack-setup
  acorn status --json
  acorn doctor
  acorn install --force
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

function formatError(e: unknown): string {
  if (e instanceof InstallError) {
    const head = `[install/${e.code}] ${e.message}`;
    return e.hint ? `${head}\n   → ${e.hint}` : head;
  }
  if (e instanceof LockError) return `[lock/${e.code}] ${e.message}`;
  if (e instanceof VendorError) return `[vendor/${e.code}/${e.tool}] ${e.message}`;
  if (e instanceof SettingsError) return `[settings/${e.code}] ${e.message}`;
  if (e instanceof SymlinkError) return `[symlink/${e.code}] ${e.message}`;
  if (e instanceof Error) return e.message;
  return String(e);
}

function exitFor(e: unknown): number {
  if (e instanceof InstallError) {
    if (e.code === 'IN_PROGRESS') return EXIT.IN_PROGRESS;
    if (e.code === 'SETTINGS_CONFLICT') return EXIT.CONFIG;
  }
  if (e instanceof LockError && e.code === 'SCHEMA') return EXIT.CONFIG;
  return EXIT.FAILURE;
}

function cmdInstall(parsed: ParsedArgs, io: CliIO): number {
  try {
    const runSetup = parsed.flags.has('run-gstack-setup');
    const skipSetup = parsed.flags.has('skip-gstack-setup');
    if (runSetup && skipSetup) {
      io.stderr(
        `[install/ARGS] --run-gstack-setup 와 --skip-gstack-setup 는 동시에 지정할 수 없습니다.`,
      );
      return EXIT.FAILURE;
    }
    const r = runInstall({
      logger: (l) => io.stdout(l),
      force: parsed.flags.has('force'),
      skipGstackSetup: skipSetup,
      ...(runSetup ? { gstackSetup: defaultGstackSetup } : {}),
    });
    io.stdout('');
    io.stdout(`✅ 설치 완료`);
    io.stdout(`   settings: ${r.settings.action}  hooks: ${r.hooks.action}  vendors: ${Object.values(r.vendors).map((v) => `${v.tool}=${v.action}`).join(' ')}`);
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

function cmdDoctor(parsed: ParsedArgs, io: CliIO): number {
  try {
    // §15 M3: doctor 도 runtime env check 활성.
    const r = runDoctor({ runtimeEnv: process.env });
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
    case 'status':
      return cmdStatus(parsed, io);
    case 'doctor':
      return cmdDoctor(parsed, io);
    case 'lock':
      return cmdLock(rest, io);
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
    io.stdout(
      `✅ harness.lock OK  ` +
        `(schema_version=${lock.schema_version}, ` +
        `acorn_version=${lock.acorn_version}, ` +
        `tools=${Object.keys(lock.tools).length}, ` +
        `guard=${lock.guard.mode}/${lock.guard.patterns})`,
    );
    return EXIT.OK;
  } catch (e) {
    io.stderr(formatError(e));
    return exitFor(e);
  }
}

// ESM entrypoint: 직접 실행될 때만 process.exit
// Windows 경로/심링크 환경에서도 일치시키기 위해 realpath 해석 후 pathToFileURL 로 정규화
import { pathToFileURL, fileURLToPath } from 'node:url';
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
