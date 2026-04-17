import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { defaultHarnessRoot } from './env.ts';

export type TxStatus = 'begin' | 'phase' | 'commit' | 'abort';

export interface TxEvent {
  readonly ts: string;
  readonly status: TxStatus;
  readonly phase?: string;
  readonly reason?: string;
}

export function txLogPath(harnessRoot?: string): string {
  return join(harnessRoot ?? defaultHarnessRoot(), 'tx.log');
}

function now(): string {
  return new Date().toISOString();
}

export function appendTx(event: TxEvent, harnessRoot?: string): void {
  const path = txLogPath(harnessRoot);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8');
}

interface ReadEventsResult {
  readonly events: TxEvent[];
  readonly corrupt: boolean;
}

function readEvents(path: string): ReadEventsResult {
  if (!existsSync(path)) return { events: [], corrupt: false };
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const events: TxEvent[] = [];
  let corrupt = false;
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as TxEvent;
      events.push(parsed);
    } catch {
      corrupt = true;
    }
  }
  return { events, corrupt };
}

/**
 * 가장 최근 transaction 의 상태를 반환한다.
 * 마지막 이벤트가 'begin' 또는 'phase' 이면 해당 이벤트를 반환 (in_progress).
 * 'commit' / 'abort' 이면 null.
 * 파일이 없거나 비어있으면 null.
 *
 * §15 H3: tx.log 에 JSON 파싱 불가 라인이 있으면 partial-write crash 가능성.
 * 마지막 valid 이벤트가 commit 이어도 corrupt 상태는 fail-close 처리
 * (IN_PROGRESS 동등) — 사용자 수동 검사 유도. 이전엔 catch 로 skip 하여
 * fail-open 이 발생했다 (false clean 상태).
 */
export function lastInProgress(harnessRoot?: string): TxEvent | null {
  const { events, corrupt } = readEvents(txLogPath(harnessRoot));
  if (corrupt) {
    return {
      ts: '(corrupt)',
      status: 'begin',
      phase: '<corrupt-tx-log>',
      reason: 'tx.log 에 JSON 파싱 불가 라인 존재 — partial-write crash 의심',
    };
  }
  if (events.length === 0) return null;
  const last = events[events.length - 1];
  if (!last) return null;
  if (last.status === 'begin' || last.status === 'phase') {
    return last;
  }
  return null;
}

export interface TxHandle {
  readonly harnessRoot: string | undefined;
  phase(name: string): void;
  commit(): void;
  abort(reason: string): void;
}

export function beginTx(harnessRoot?: string): TxHandle {
  appendTx({ ts: now(), status: 'begin' }, harnessRoot);
  return {
    harnessRoot,
    phase(name) {
      appendTx({ ts: now(), status: 'phase', phase: name }, harnessRoot);
    },
    commit() {
      appendTx({ ts: now(), status: 'commit' }, harnessRoot);
    },
    abort(reason) {
      appendTx({ ts: now(), status: 'abort', reason }, harnessRoot);
    },
  };
}
