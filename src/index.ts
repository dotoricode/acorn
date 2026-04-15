#!/usr/bin/env node
// acorn — Claude Code harness manager CLI router

import { runInstall, InstallError } from './commands/install.ts';
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
import { LockError } from './core/lock.ts';
import { VendorError } from './core/vendors.ts';
import { SettingsError } from './core/settings.ts';
import { SymlinkError } from './core/symlink.ts';

export const VERSION = '0.1.0';

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
  install   harness.lock 기준으로 OMC/gstack/ECC 설치 + env 주입
  status    현재 설치 상태 요약 (read-only)
  doctor    진단 + 권장 조치

Global flags:
  -h, --help      도움말
  -V, --version   버전 출력
  --json          JSON 출력 (status, doctor)

install flags:
  --force             이전 tx.log in_progress 우회
  --skip-gstack-setup gstack setup 콜백 생략

예시:
  acorn install
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
    const r = runInstall({
      logger: (l) => io.stdout(l),
      force: parsed.flags.has('force'),
      skipGstackSetup: parsed.flags.has('skip-gstack-setup'),
    });
    io.stdout('');
    io.stdout(`✅ 설치 완료`);
    io.stdout(`   settings: ${r.settings.action}  vendors: ${Object.values(r.vendors).map((v) => `${v.tool}=${v.action}`).join(' ')}`);
    return EXIT.OK;
  } catch (e) {
    io.stderr(formatError(e));
    return exitFor(e);
  }
}

function cmdStatus(parsed: ParsedArgs, io: CliIO): number {
  try {
    const r = collectStatus();
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
    const r = runDoctor();
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
    default:
      io.stderr(`알 수 없는 커맨드: ${head}`);
      io.stderr('');
      io.stderr(usage());
      return EXIT.USAGE;
  }
}

// ESM entrypoint: 직접 실행될 때만 process.exit
const isMain =
  typeof process.argv[1] === 'string' &&
  import.meta.url === `file://${process.argv[1]}`;

if (isMain) {
  const code = runCli(process.argv.slice(2));
  process.exit(code);
}
