/**
 * §15 v0.6.0 — `acorn list` 커맨드.
 * 읽기 전용 (등급 1): harness.lock 에 기록된 tool 의 repo / SHA / 설치 상태를
 * 간결하게 나열. `acorn status` 가 설정/심링크/guard/tx 까지 포괄하는 반면
 * `acorn list` 는 "어떤 tool 이 어떤 SHA 로 잠겨있나" 에만 초점.
 *
 * 출력:
 *   - 기본: 표 형식 (TOOL / SHA / STATE / REPO)
 *   - `--json`: 기계 판독용 JSON (CI/jq 용)
 */
import { readLock, TOOL_NAMES, type HarnessLock, type ToolName } from '../core/lock.ts';
import { defaultHarnessRoot, vendorsRoot } from '../core/env.ts';
import {
  defaultGitRunner,
  readCurrentCommit,
  type GitRunner,
} from '../core/vendors.ts';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { shortSha, distinguishingPair } from '../core/sha-display.ts';

export type ListState = 'locked' | 'drift' | 'missing' | 'error';

export interface ListEntry {
  readonly tool: ToolName;
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

export function collectList(opts: ListOptions = {}): ListReport {
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();
  const git = opts.git ?? defaultGitRunner;
  const lock = readLock(opts.lockPath) as HarnessLock;
  const vRoot = vendorsRoot(harnessRoot);

  const tools: ListEntry[] = [];
  for (const name of TOOL_NAMES) {
    const entry = lock.tools[name];
    const path = join(vRoot, name);
    if (!existsSync(path)) {
      tools.push({
        tool: name,
        repo: entry.repo,
        lockCommit: entry.commit,
        actualCommit: null,
        state: 'missing',
      });
      continue;
    }
    try {
      const actual = readCurrentCommit(path, git);
      tools.push({
        tool: name,
        repo: entry.repo,
        lockCommit: entry.commit,
        actualCommit: actual,
        state: actual === entry.commit ? 'locked' : 'drift',
      });
    } catch (e) {
      tools.push({
        tool: name,
        repo: entry.repo,
        lockCommit: entry.commit,
        actualCommit: null,
        state: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { harnessRoot, acornVersion: lock.acorn_version, tools };
}

function stateIcon(state: ListState): string {
  switch (state) {
    case 'locked':
      return '✅';
    case 'drift':
      return '⚠️';
    case 'missing':
      return '❌';
    case 'error':
      return '⛔';
  }
}

export function renderList(r: ListReport): string {
  const lines: string[] = [];
  lines.push(`acorn v${r.acornVersion}  •  ${r.harnessRoot}`);
  lines.push('─'.repeat(72));
  // 헤더
  lines.push(
    `  ${'TOOL'.padEnd(8)} ${'SHA'.padEnd(10)} ${'STATE'.padEnd(8)} REPO`,
  );
  for (const t of r.tools) {
    let shaDisp: string;
    if (t.state === 'drift' && t.actualCommit) {
      const [lockDisp, actualDisp] = distinguishingPair(t.lockCommit, t.actualCommit);
      shaDisp = `${lockDisp}→${actualDisp}`;
    } else {
      shaDisp = shortSha(t.lockCommit);
    }
    lines.push(
      `  ${t.tool.padEnd(8)} ${shaDisp.padEnd(10)} ${stateIcon(t.state)} ${t.state.padEnd(6)} ${t.repo}`,
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

/**
 * list 의 "문제 있음" 판정. missing / drift / error 는 모두 비-locked 상태로
 * 사용자가 알아야 할 이슈. CI 에서 `acorn list` 실행 시 exit code 로 표현.
 */
export function summarizeList(r: ListReport): ListSummary {
  const issues: string[] = [];
  for (const t of r.tools) {
    if (t.state !== 'locked') issues.push(`${t.tool}: ${t.state}`);
  }
  return { ok: issues.length === 0, issues };
}
