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

test('손상된 라인 있어도 lastInProgress 판정 가능', () => {
  const w = makeRoot();
  try {
    const path = txLogPath(w.root);
    const tx = beginTx(w.root);
    tx.phase('vendors');
    // append 손상 라인
    mkdirSync(w.root, { recursive: true });
    appendFileSync(path, 'not json\n');
    const pending = lastInProgress(w.root);
    assert.ok(pending);
    assert.equal(pending?.phase, 'vendors');
  } finally {
    w.cleanup();
  }
});
