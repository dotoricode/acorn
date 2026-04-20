import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PHASE_MARKER_START,
  PHASE_MARKER_END,
  renderPhaseBlock,
  planClaudeMdUpdate,
  applyClaudeMdUpdate,
  readPhaseFromClaudeMd,
  claudeMdMarkerStatus,
  ClaudeMdError,
} from '../src/core/claude-md.ts';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'acorn-claude-md-test-'));
}

test('renderPhaseBlock: contains markers and keyword', () => {
  for (const phase of ['prototype', 'dev', 'production'] as const) {
    const block = renderPhaseBlock(phase);
    assert.ok(block.startsWith(PHASE_MARKER_START), 'must start with START marker');
    assert.ok(block.endsWith(PHASE_MARKER_END), 'must end with END marker');
    assert.ok(block.includes(`ACORN_PHASE_KEYWORD: ${phase}`));
    assert.ok(block.includes(`## Acorn Phase: ${phase}`));
  }
});

test('planClaudeMdUpdate: create when no current file', () => {
  const plan = planClaudeMdUpdate(null, 'dev');
  assert.equal(plan.action, 'create');
  assert.equal(plan.currentBlock, null);
  assert.ok(plan.nextText.includes(PHASE_MARKER_START));
});

test('planClaudeMdUpdate: append when file exists but no marker', () => {
  const existing = '# My Project\n\nSome content.\n';
  const plan = planClaudeMdUpdate(existing, 'dev');
  assert.equal(plan.action, 'update');
  assert.equal(plan.currentBlock, null);
  assert.ok(plan.nextText.startsWith('# My Project'));
  assert.ok(plan.nextText.includes(PHASE_MARKER_START));
});

test('planClaudeMdUpdate: noop when same phase marker exists', () => {
  const block = renderPhaseBlock('dev');
  const existing = `# Project\n\n${block}\n`;
  const plan = planClaudeMdUpdate(existing, 'dev');
  assert.equal(plan.action, 'noop');
  assert.equal(plan.nextText, existing);
});

test('planClaudeMdUpdate: replace when different phase in marker', () => {
  const oldBlock = renderPhaseBlock('dev');
  const existing = `# Project\n\n${oldBlock}\n`;
  const plan = planClaudeMdUpdate(existing, 'production');
  assert.equal(plan.action, 'update');
  assert.ok(plan.nextText.includes('ACORN_PHASE_KEYWORD: production'));
  assert.ok(!plan.nextText.includes('ACORN_PHASE_KEYWORD: dev'));
  // Content outside marker is preserved
  assert.ok(plan.nextText.includes('# Project'));
});

test('planClaudeMdUpdate: throws MARKER_CORRUPT when START without END', () => {
  const corrupt = `# Project\n\n${PHASE_MARKER_START}\nsome content without end\n`;
  assert.throws(
    () => planClaudeMdUpdate(corrupt, 'dev'),
    (e: unknown) => e instanceof ClaudeMdError && e.code === 'MARKER_CORRUPT',
  );
});

test('applyClaudeMdUpdate: creates new file', () => {
  const root = tmpDir();
  try {
    const claudeMdPath = join(root, 'CLAUDE.md');
    const result = applyClaudeMdUpdate({ claudeMdPath, harnessRoot: root, phase: 'dev' });
    assert.equal(result.kind, 'created');
    assert.ok(existsSync(claudeMdPath));
    const content = readFileSync(claudeMdPath, 'utf8');
    assert.ok(content.includes('ACORN_PHASE_KEYWORD: dev'));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('applyClaudeMdUpdate: updates existing file + creates backup', () => {
  const root = tmpDir();
  try {
    const claudeMdPath = join(root, 'CLAUDE.md');
    writeFileSync(claudeMdPath, `# Project\n\n${renderPhaseBlock('dev')}\n`);
    const result = applyClaudeMdUpdate({
      claudeMdPath,
      harnessRoot: root,
      phase: 'production',
      backupTs: '2026-01-01T000000',
    });
    assert.equal(result.kind, 'updated');
    const content = readFileSync(claudeMdPath, 'utf8');
    assert.ok(content.includes('ACORN_PHASE_KEYWORD: production'));
    assert.ok(content.includes('# Project'));
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('applyClaudeMdUpdate: noop returns noop', () => {
  const root = tmpDir();
  try {
    const claudeMdPath = join(root, 'CLAUDE.md');
    writeFileSync(claudeMdPath, `${renderPhaseBlock('dev')}\n`);
    const result = applyClaudeMdUpdate({ claudeMdPath, harnessRoot: root, phase: 'dev' });
    assert.equal(result.kind, 'noop');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('readPhaseFromClaudeMd: returns null when no file', () => {
  const root = tmpDir();
  try {
    const result = readPhaseFromClaudeMd(join(root, 'CLAUDE.md'));
    assert.equal(result, null);
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('readPhaseFromClaudeMd: returns phase from marker', () => {
  const root = tmpDir();
  try {
    const claudeMdPath = join(root, 'CLAUDE.md');
    writeFileSync(claudeMdPath, `${renderPhaseBlock('prototype')}\n`);
    const result = readPhaseFromClaudeMd(claudeMdPath);
    assert.equal(result, 'prototype');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('claudeMdMarkerStatus: missing when no file', () => {
  const root = tmpDir();
  try {
    const status = claudeMdMarkerStatus(join(root, 'CLAUDE.md'), 'dev');
    assert.equal(status, 'missing');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('claudeMdMarkerStatus: ok when phase matches', () => {
  const root = tmpDir();
  try {
    const claudeMdPath = join(root, 'CLAUDE.md');
    writeFileSync(claudeMdPath, `${renderPhaseBlock('dev')}\n`);
    assert.equal(claudeMdMarkerStatus(claudeMdPath, 'dev'), 'ok');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('claudeMdMarkerStatus: mismatch when phase differs', () => {
  const root = tmpDir();
  try {
    const claudeMdPath = join(root, 'CLAUDE.md');
    writeFileSync(claudeMdPath, `${renderPhaseBlock('dev')}\n`);
    assert.equal(claudeMdMarkerStatus(claudeMdPath, 'production'), 'mismatch');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('claudeMdMarkerStatus: corrupt when only START marker present', () => {
  const root = tmpDir();
  try {
    const claudeMdPath = join(root, 'CLAUDE.md');
    writeFileSync(claudeMdPath, `${PHASE_MARKER_START}\nno end marker`);
    assert.equal(claudeMdMarkerStatus(claudeMdPath, 'dev'), 'corrupt');
  } finally {
    rmSync(root, { recursive: true });
  }
});
