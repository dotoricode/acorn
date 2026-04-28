/**
 * §15 v0.6.0 — `acorn list` 커맨드.
 * 읽기 전용 (등급 1): harness.lock 에 기록된 tool/provider 의 repo / SHA / 설치 상태를
 * 간결하게 나열. `acorn status` 가 설정/심링크/guard/tx 까지 포괄하는 반면
 * `acorn list` 는 "어떤 tool/provider 가 어떤 SHA 로 잠겨있나" 에만 초점.
 *
 * 출력:
 *   - 기본: 표 형식 (TOOL / SHA / STATE / REPO)
 *   - `--json`: 기계 판독용 JSON (CI/jq 용)
 */
import {
  readLock,
  TOOL_NAMES,
  type AnyHarnessLock,
  type HarnessLock,
  type HarnessLockV3,
  type ToolName,
} from '../core/lock.ts';
import { defaultHarnessRoot, vendorsRoot } from '../core/env.ts';
import {
  defaultGitRunner,
  readCurrentCommit,
  type GitRunner,
} from '../core/vendors.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { shortSha, distinguishingPair } from '../core/sha-display.ts';

export type ListState = 'locked' | 'drift' | 'missing' | 'error' | 'npx' | 'plugin';

export interface ListEntry {
  readonly tool: string;
  readonly repo: string;
  readonly lockCommit: string;
  readonly actualCommit: string | null;
  readonly state: ListState;
  readonly error?: string;
}

export interface ListReport {
  readonly harnessRoot: string;
  readonly acornVersion: string;
  readonly tools: readonly ListEntry[];
}

export interface ListOptions {
  readonly lockPath?: string;
  readonly harnessRoot?: string;
  readonly git?: GitRunner;
}

function collectV2(lock: HarnessLock, vRoot: string, git: GitRunner): ListEntry[] {
  const tools: ListEntry[] = [];
  for (const name of TOOL_NAMES) {
    const entry = lock.tools[name];
    const path = join(vRoot, name);
    if (!existsSync(path)) {
      tools.push({ tool: name, repo: entry.repo, lockCommit: entry.commit, actualCommit: null, state: 'missing' });
      continue;
    }
    try {
      const actual = readCurrentCommit(path, git);
      tools.push({ tool: name, repo: entry.repo, lockCommit: entry.commit, actualCommit: actual, state: actual === entry.commit ? 'locked' : 'drift' });
    } catch (e) {
      tools.push({ tool: name, repo: entry.repo, lockCommit: entry.commit, actualCommit: null, state: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }
  return tools;
}

function collectV3(lock: HarnessLockV3, vRoot: string, git: GitRunner): ListEntry[] {
  const tools: ListEntry[] = [];
  for (const [name, entry] of Object.entries(lock.providers)) {
    if (entry.install_strategy === 'git-clone') {
      const path = join(vRoot, name);
      if (!existsSync(path)) {
        tools.push({ tool: name, repo: entry.repo, lockCommit: entry.commit, actualCommit: null, state: 'missing' });
        continue;
      }
      try {
        const actual = readCurrentCommit(path, git);
        tools.push({ tool: name, repo: entry.repo, lockCommit: entry.commit, actualCommit: actual, state: actual === entry.commit ? 'locked' : 'drift' });
      } catch (e) {
        tools.push({ tool: name, repo: entry.repo, lockCommit: entry.commit, actualCommit: null, state: 'error', error: e instanceof Error ? e.message : String(e) });
      }
    } else if (entry.install_strategy === 'plugin-marketplace') {
      // v0.9.2: plugin marketplace 는 acorn 외부 (Claude Code) 설치라 lock 가
      // SHA/cmd 같은 값을 갖지 않는다. repo 칼럼에 플러그인 좌표만 노출.
      tools.push({
        tool: name,
        repo: `${entry.plugin}@${entry.marketplace}`,
        lockCommit: '',
        actualCommit: null,
        state: 'plugin',
      });
    } else {
      tools.push({ tool: name, repo: entry.install_cmd, lockCommit: '', actualCommit: null, state: 'npx' });
    }
  }
  return tools;
}

export function collectList(opts: ListOptions = {}): ListReport {
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();
  const git = opts.git ?? defaultGitRunner;
  const anyLock: AnyHarnessLock = readLock(opts.lockPath);
  const vRoot = vendorsRoot(harnessRoot);

  const tools = anyLock.schema_version === 3
    ? collectV3(anyLock as HarnessLockV3, vRoot, git)
    : collectV2(anyLock as HarnessLock, vRoot, git);

  return { harnessRoot, acornVersion: anyLock.acorn_version, tools };
}

function stateIcon(state: ListState): string {
  switch (state) {
    case 'locked': return '✅';
    case 'drift':  return '⚠️';
    case 'missing': return '❌';
    case 'error':  return '⛔';
    case 'npx':   return '📦';
    case 'plugin': return '🔌';
  }
}

export function renderList(r: ListReport): string {
  const lines: string[] = [];
  lines.push(`acorn v${r.acornVersion}  •  ${r.harnessRoot}`);
  lines.push('─'.repeat(72));
  lines.push(`  ${'TOOL'.padEnd(12)} ${'SHA'.padEnd(10)} ${'STATE'.padEnd(8)} REPO/CMD`);
  for (const t of r.tools) {
    let shaDisp: string;
    if (t.state === 'drift' && t.actualCommit) {
      const [lockDisp, actualDisp] = distinguishingPair(t.lockCommit, t.actualCommit);
      shaDisp = `${lockDisp}→${actualDisp}`;
    } else if (t.state === 'npx') {
      shaDisp = 'npx';
    } else if (t.state === 'plugin') {
      shaDisp = 'plugin';
    } else {
      shaDisp = shortSha(t.lockCommit);
    }
    lines.push(
      `  ${t.tool.padEnd(12)} ${shaDisp.padEnd(10)} ${stateIcon(t.state)} ${t.state.padEnd(6)} ${t.repo}`,
    );
  }
  return lines.join('\n');
}

export function renderListJson(r: ListReport): string {
  return JSON.stringify(r, null, 2);
}

export interface ListSummary {
  readonly ok: boolean;
  readonly issues: readonly string[];
}

export function summarizeList(r: ListReport): ListSummary {
  const issues: string[] = [];
  for (const t of r.tools) {
    // npx / plugin 은 acorn 이 직접 추적할 수 없는 외부 설치라 issue 가 아님.
    if (t.state !== 'locked' && t.state !== 'npx' && t.state !== 'plugin') {
      issues.push(`${t.tool}: ${t.state}`);
    }
  }
  return { ok: issues.length === 0, issues };
}
