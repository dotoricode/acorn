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

function readEvents(path: string): TxEvent[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim().length > 0);
  const events: TxEvent[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as TxEvent;
      events.push(parsed);
    } catch {
      // 손상 라인은 건너뛰되 후속 in_progress 판정에는 영향 없음
    }
  }
  return events;
}

/**
 * 가장 최근 transaction 의 상태를 반환한다.
 * 마지막 이벤트가 'begin' 또는 'phase' 이면 해당 이벤트를 반환 (in_progress).
 * 'commit' / 'abort' 이면 null.
 * 파일이 없거나 비어있으면 null.
 */
export function lastInProgress(harnessRoot?: string): TxEvent | null {
  const events = readEvents(txLogPath(harnessRoot));
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
