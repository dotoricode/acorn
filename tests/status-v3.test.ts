process.env['ACORN_ALLOW_ANY_REPO'] = '1';

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { collectStatus, renderStatus, summarize } from '../src/commands/status.ts';
import type { DetectEnv } from '../src/core/provider-detect.ts';
import type { GitRunner } from '../src/core/vendors.ts';

// ── fixtures ──────────────────────────────────────────────────────────────────

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

const V3_LOCK = JSON.stringify({
  schema_version: 3,
  acorn_version: '0.9.0',
  capabilities: {
    hooks:       { providers: ['gstack', 'claudekit'] },
    planning:    { providers: ['superpowers', 'gsd'] },
    tdd:         { providers: ['claudekit'] },
    review:      { providers: ['superpowers'] },
    qa_headless: { providers: ['gsd'] },
  },
  providers: {
    gstack:      { install_strategy: 'git-clone', repo: 'garrytan/gstack',     commit: SHA_A, verified_at: '2026-01-01' },
    superpowers: { install_strategy: 'git-clone', repo: 'obra/superpowers',    commit: SHA_B, verified_at: '2026-01-01' },
    gsd:         { install_strategy: 'npx',       install_cmd: 'npx gsd',                    verified_at: '2026-01-01' },
    claudekit:   { install_strategy: 'npx',       install_cmd: 'npx claudekit',               verified_at: '2026-01-01' },
  },
  guard: { mode: 'block', patterns: 'strict' },
});

const V2_LOCK = JSON.stringify({
  schema_version: 2,
  acorn_version: '0.8.0',
  tools: {
    omc:    { repo: 'test/omc',    commit: SHA_A, verified_at: '2026-01-01' },
    gstack: { repo: 'test/gstack', commit: SHA_B, verified_at: '2026-01-01' },
    ecc:    { repo: 'test/ecc',    commit: SHA_C, verified_at: '2026-01-01' },
  },
  guard: { mode: 'block', patterns: 'strict' },
});

interface WS {
  harnessRoot: string;
  claudeRoot: string;
  lockPath: string;
  settingsPath: string;
}

function makeWorkspace(lockContent: string): WS {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-status-v3-'));
  const harnessRoot = join(dir, 'harness');
  const claudeRoot = join(dir, 'claude');
  mkdirSync(harnessRoot, { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  const lockPath = join(harnessRoot, 'harness.lock');
  const settingsPath = join(claudeRoot, 'settings.json');
  writeFileSync(lockPath, lockContent, 'utf8');
  return { harnessRoot, claudeRoot, lockPath, settingsPath };
}

function fakeDetectEnv(installed: string[], harnessRoot: string): DetectEnv {
  return {
    harnessRoot,
    dirExists: (p: string) => installed.some((name) => p.endsWith(name)),
    commandExists: (cmd: string) => installed.includes(cmd),
  };
}

const noopGit: GitRunner = {
  clone() { throw new Error('not used'); },
  checkout() { throw new Error('not used'); },
  revParse() { throw new Error('not used'); },
  isGitRepo() { return false; },
  isDirty() { return false; },
};

// ── v3 schema detection ────────────────────────────────────────────────────────

test('collectStatus v3: r.v3 is populated', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv([], ws.harnessRoot),
  });
  assert.ok(r.v3, 'v3 section should be present');
});

test('collectStatus v3: acornVersion from lock', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv([], ws.harnessRoot),
  });
  assert.equal(r.acornVersion, '0.9.0');
});

test('collectStatus v3: tools are all not_applicable', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv([], ws.harnessRoot),
  });
  assert.equal(r.tools.omc.state, 'not_applicable');
  assert.equal(r.tools.gstack.state, 'not_applicable');
  assert.equal(r.tools.ecc.state, 'not_applicable');
});

// ── v3 capability status ────────────────────────────────────────────────────────

test('collectStatus v3: capabilities section has all lock capabilities', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv([], ws.harnessRoot),
  });
  const caps = r.v3!.capabilities.map((c) => c.capability);
  assert.ok(caps.includes('hooks'));
  assert.ok(caps.includes('planning'));
  assert.ok(caps.includes('qa_headless'));
});

test('collectStatus v3: all providers missing when nothing installed', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv([], ws.harnessRoot),
  });
  for (const cap of r.v3!.capabilities) {
    assert.equal(cap.anyInstalled, false, `${cap.capability} should have no installed providers`);
  }
});

test('collectStatus v3: gstack installed → hooks anyInstalled=true', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv(['gstack'], ws.harnessRoot),
  });
  const hooksCap = r.v3!.capabilities.find((c) => c.capability === 'hooks');
  assert.ok(hooksCap);
  assert.equal(hooksCap.anyInstalled, true);
  const gstackState = hooksCap.providerStates.find((p) => p.provider === 'gstack');
  assert.equal(gstackState?.state, 'installed');
  const claudekitState = hooksCap.providerStates.find((p) => p.provider === 'claudekit');
  assert.equal(claudekitState?.state, 'missing');
});

test('collectStatus v3: claudekit (npx) installed via commandExists', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv(['claudekit'], ws.harnessRoot),
  });
  const hooksCap = r.v3!.capabilities.find((c) => c.capability === 'hooks');
  assert.ok(hooksCap);
  const claudekitState = hooksCap.providerStates.find((p) => p.provider === 'claudekit');
  assert.equal(claudekitState?.state, 'installed');
});

test('collectStatus v3: all providers installed → all caps anyInstalled=true', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv(['gstack', 'superpowers', 'gsd', 'claudekit'], ws.harnessRoot),
  });
  for (const cap of r.v3!.capabilities) {
    assert.equal(cap.anyInstalled, true, `${cap.capability} should be installed`);
  }
});

// ── v3 preset ─────────────────────────────────────────────────────────────────

test('collectStatus v3: preset missing when no preset.txt', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv([], ws.harnessRoot),
  });
  assert.equal(r.v3!.preset.status, 'missing');
  assert.equal(r.v3!.preset.value, null);
});

test('collectStatus v3: preset.txt set → preset shown', () => {
  const ws = makeWorkspace(V3_LOCK);
  writeFileSync(join(ws.harnessRoot, 'preset.txt'), 'backend\n', 'utf8');
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv([], ws.harnessRoot),
  });
  assert.equal(r.v3!.preset.value, 'backend');
  assert.equal(r.v3!.preset.legacy, false);
});

test('collectStatus v3: phase.txt legacy → preset shown with legacy=true', () => {
  const ws = makeWorkspace(V3_LOCK);
  writeFileSync(join(ws.harnessRoot, 'phase.txt'), 'dev\n', 'utf8');
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv([], ws.harnessRoot),
  });
  assert.equal(r.v3!.preset.value, 'builder');
  assert.equal(r.v3!.preset.legacy, true);
});

// ── v3 lockProviders ──────────────────────────────────────────────────────────

test('collectStatus v3: lockProviders populated from lock.providers', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv([], ws.harnessRoot),
  });
  const names = r.v3!.lockProviders.map((p) => p.provider);
  assert.ok(names.includes('gstack'));
  assert.ok(names.includes('superpowers'));
  assert.ok(names.includes('gsd'));
  assert.ok(names.includes('claudekit'));
});

test('collectStatus v3: git-clone provider has commit field', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv([], ws.harnessRoot),
  });
  const gstack = r.v3!.lockProviders.find((p) => p.provider === 'gstack');
  assert.equal(gstack?.installStrategy, 'git-clone');
  assert.equal(gstack?.commit, SHA_A);
});

test('collectStatus v3: npx provider has no commit field', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv([], ws.harnessRoot),
  });
  const gsd = r.v3!.lockProviders.find((p) => p.provider === 'gsd');
  assert.equal(gsd?.installStrategy, 'npx');
  assert.equal(gsd?.commit, undefined);
});

// ── summarize v3 ──────────────────────────────────────────────────────────────

test('summarize v3: all providers missing → issues reported', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv([], ws.harnessRoot),
  });
  const s = summarize(r);
  assert.equal(s.ok, false);
  assert.ok(s.issues.some((i) => i.includes('capability.')));
});

test('summarize v3: all providers installed → no capability issues', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv(['gstack', 'superpowers', 'gsd', 'claudekit'], ws.harnessRoot),
  });
  const s = summarize(r);
  assert.ok(!s.issues.some((i) => i.includes('capability.')));
});

// ── renderStatus v3 ───────────────────────────────────────────────────────────

test('renderStatus v3: includes preset and capabilities', () => {
  const ws = makeWorkspace(V3_LOCK);
  writeFileSync(join(ws.harnessRoot, 'preset.txt'), 'backend\n', 'utf8');
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv(['gstack'], ws.harnessRoot),
  });
  const output = renderStatus(r);
  assert.ok(output.includes('preset'), 'should show preset');
  assert.ok(output.includes('backend'), 'should show preset value');
  assert.ok(output.includes('hooks'), 'should show capabilities');
  assert.ok(output.includes('qa_headless'), 'should show qa_headless capability');
});

test('renderStatus v3: does not show omc/gstack/ecc tool rows', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv([], ws.harnessRoot),
  });
  const output = renderStatus(r);
  // v2 tool names should not appear as tool rows
  assert.ok(!output.match(/^\s+omc\s+/m), 'omc tool row should not appear');
  assert.ok(!output.match(/^\s+ecc\s+/m), 'ecc tool row should not appear');
});

test('renderStatus v3: installed provider shows ●, missing shows ○', () => {
  const ws = makeWorkspace(V3_LOCK);
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: noopGit,
    detectEnv: fakeDetectEnv(['gstack'], ws.harnessRoot),
  });
  const output = renderStatus(r);
  assert.ok(output.includes('● gstack'), 'installed gstack should show ●');
});

// ── v2 regression ─────────────────────────────────────────────────────────────

test('collectStatus v2: r.v3 is undefined (legacy path intact)', () => {
  const ws = makeWorkspace(V2_LOCK);
  const gitMock: GitRunner = {
    clone() { throw new Error('not used'); },
    checkout() { throw new Error('not used'); },
    revParse() { return SHA_A; },
    isGitRepo() { return true; },
    isDirty() { return false; },
  };
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: gitMock,
  });
  assert.equal(r.v3, undefined, 'v2 lock should not populate v3');
});

test('collectStatus v2: tools record fully populated', () => {
  const ws = makeWorkspace(V2_LOCK);
  const gitMock: GitRunner = {
    clone() { throw new Error('not used'); },
    checkout() { throw new Error('not used'); },
    revParse() { return SHA_A; },
    isGitRepo() { return true; },
    isDirty() { return false; },
  };
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: gitMock,
  });
  // v2: omc/gstack/ecc should have real states (missing since dir doesn't exist)
  assert.notEqual(r.tools.omc.state, 'not_applicable');
  assert.equal(r.tools.omc.state, 'missing');
});

test('renderStatus v2: shows omc/gstack/ecc tool rows (no regression)', () => {
  const ws = makeWorkspace(V2_LOCK);
  const gitMock: GitRunner = {
    clone() { throw new Error('not used'); },
    checkout() { throw new Error('not used'); },
    revParse() { return SHA_A; },
    isGitRepo() { return true; },
    isDirty() { return false; },
  };
  const r = collectStatus({
    lockPath: ws.lockPath,
    harnessRoot: ws.harnessRoot,
    claudeRoot: ws.claudeRoot,
    settingsPath: ws.settingsPath,
    git: gitMock,
  });
  const output = renderStatus(r);
  assert.ok(output.includes('omc'), 'v2 should show omc row');
  assert.ok(output.includes('ecc'), 'v2 should show ecc row');
  assert.ok(!output.includes('capabilities:'), 'v2 should not show capabilities section');
});
