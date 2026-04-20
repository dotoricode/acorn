import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readPhase,
  writePhase,
  seedPhaseDefault,
  isValidPhase,
  PHASES,
} from '../src/core/phase.ts';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'acorn-phase-test-'));
}

test('isValidPhase: valid phases', () => {
  for (const p of PHASES) {
    assert.ok(isValidPhase(p), `${p} should be valid`);
  }
});

test('isValidPhase: invalid values', () => {
  assert.ok(!isValidPhase('staging'));
  assert.ok(!isValidPhase(''));
  assert.ok(!isValidPhase(null));
  assert.ok(!isValidPhase(123));
});

test('readPhase: missing file → status=missing, value=null', () => {
  const root = tmpDir();
  try {
    const r = readPhase(root);
    assert.equal(r.value, null);
    assert.equal(r.status, 'missing');
    assert.ok(r.path.endsWith('phase.txt'));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('readPhase: invalid content → status=invalid, value=null', () => {
  const root = tmpDir();
  try {
    writeFileSync(join(root, 'phase.txt'), 'staging\n');
    const r = readPhase(root);
    assert.equal(r.value, null);
    assert.equal(r.status, 'invalid');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('readPhase: valid content → status=ok, correct value', () => {
  const root = tmpDir();
  try {
    writeFileSync(join(root, 'phase.txt'), 'production\n');
    const r = readPhase(root);
    assert.equal(r.value, 'production');
    assert.equal(r.status, 'ok');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('readPhase: strips whitespace/BOM', () => {
  const root = tmpDir();
  try {
    // BOM + trailing spaces
    writeFileSync(join(root, 'phase.txt'), '\uFEFFdev  \n');
    const r = readPhase(root);
    assert.equal(r.value, 'dev');
    assert.equal(r.status, 'ok');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('writePhase: creates file with correct content (atomic)', () => {
  const root = tmpDir();
  try {
    writePhase('prototype', root);
    const content = readFileSync(join(root, 'phase.txt'), 'utf8');
    assert.equal(content, 'prototype\n');
    const r = readPhase(root);
    assert.equal(r.value, 'prototype');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('writePhase: overwrites existing value', () => {
  const root = tmpDir();
  try {
    writePhase('dev', root);
    writePhase('production', root);
    const r = readPhase(root);
    assert.equal(r.value, 'production');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('seedPhaseDefault: seeds dev when file absent', () => {
  const root = tmpDir();
  try {
    const result = seedPhaseDefault(root);
    assert.ok(result.seeded);
    const r = readPhase(root);
    assert.equal(r.value, 'dev');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('seedPhaseDefault: noop when file exists', () => {
  const root = tmpDir();
  try {
    writePhase('production', root);
    const result = seedPhaseDefault(root);
    assert.ok(!result.seeded);
    const r = readPhase(root);
    assert.equal(r.value, 'production');
  } finally {
    rmSync(root, { recursive: true });
  }
});
