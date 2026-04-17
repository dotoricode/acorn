import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  readFileSync,
  appendFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beginTx, lastInProgress, txLogPath } from '../src/core/tx.ts';

function makeRoot(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'acorn-tx-'));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('lastInProgress: 파일 없음 → null', () => {
  const w = makeRoot();
  try {
    assert.equal(lastInProgress(w.root), null);
  } finally {
    w.cleanup();
  }
});

test('beginTx + commit → lastInProgress 는 null', () => {
  const w = makeRoot();
  try {
    const tx = beginTx(w.root);
    tx.phase('vendors');
    tx.commit();
    assert.equal(lastInProgress(w.root), null);
    assert.ok(existsSync(txLogPath(w.root)));
  } finally {
    w.cleanup();
  }
});

test('beginTx + phase (commit 없음) → lastInProgress 는 해당 phase', () => {
  const w = makeRoot();
  try {
    const tx = beginTx(w.root);
    tx.phase('vendors');
    const pending = lastInProgress(w.root);
    assert.ok(pending);
    assert.equal(pending?.status, 'phase');
    assert.equal(pending?.phase, 'vendors');
  } finally {
    w.cleanup();
  }
});

test('beginTx + abort → lastInProgress 는 null', () => {
  const w = makeRoot();
  try {
    const tx = beginTx(w.root);
    tx.phase('vendors');
    tx.abort('simulated');
    assert.equal(lastInProgress(w.root), null);
  } finally {
    w.cleanup();
  }
});

test('JSONL 포맷 — 각 라인 파싱 가능', () => {
  const w = makeRoot();
  try {
    const tx = beginTx(w.root);
    tx.phase('env');
    tx.phase('vendors');
    tx.commit();
    const raw = readFileSync(txLogPath(w.root), 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim());
    assert.equal(lines.length, 4);
    for (const line of lines) JSON.parse(line); // must not throw
  } finally {
    w.cleanup();
  }
});

test('tx.log 손상 라인 → <corrupt-tx-log> 로 fail-close 반환 (§15 H3)', () => {
  const w = makeRoot();
  try {
    const path = txLogPath(w.root);
    const tx = beginTx(w.root);
    tx.phase('vendors');
    // append 손상 라인 (partial-write crash 시뮬)
    mkdirSync(w.root, { recursive: true });
    appendFileSync(path, 'not json\n');
    const pending = lastInProgress(w.root);
    assert.ok(pending, 'corrupt 상태는 fail-close — null 이 아닌 IN_PROGRESS 반환');
    assert.equal(pending?.phase, '<corrupt-tx-log>');
    assert.equal(pending?.status, 'begin');
    assert.ok(pending?.reason?.includes('partial-write'));
  } finally {
    w.cleanup();
  }
});

test('tx.log 손상 라인 + 마지막이 commit 이어도 fail-close (§15 H3 핵심)', () => {
  // 이전 동작: skip 하여 commit 만 보고 → null → false clean.
  // 신규 동작: corrupt 감지 시 commit 여부 무관하게 IN_PROGRESS 로 처리.
  const w = makeRoot();
  try {
    const path = txLogPath(w.root);
    const tx = beginTx(w.root);
    tx.phase('vendors');
    tx.commit();
    // commit 후 새 세션이 begin 만 쓰다가 crash — 손상 라인으로 시뮬
    mkdirSync(w.root, { recursive: true });
    appendFileSync(path, '{"ts":"x","status":"beg\n'); // malformed JSON
    const pending = lastInProgress(w.root);
    assert.ok(pending, 'commit 뒤 corrupt 라인은 false-clean 이 아닌 fail-close');
    assert.equal(pending?.phase, '<corrupt-tx-log>');
  } finally {
    w.cleanup();
  }
});
