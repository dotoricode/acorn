process.env['ACORN_ALLOW_ANY_REPO'] = '1';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runGuidedInstall, renderGuidedReport } from '../src/commands/install.ts';
import { type DetectEnv } from '../src/core/provider-detect.ts';

// ── fixtures ──────────────────────────────────────────────────────────────────

const V3_LOCK = JSON.stringify({
  schema_version: 3,
  acorn_version: '0.9.0',
  capabilities: {
    hooks: { providers: ['gstack'] },
    planning: { providers: ['superpowers', 'gsd'] },
    tdd: { providers: ['gstack'] },
    review: { providers: ['gstack'] },
  },
  providers: {
    gstack: { install_strategy: 'git-clone', repo: 'gstack-dev/gstack', commit: 'a'.repeat(40), verified_at: '2026-01-01' },
    superpowers: { install_strategy: 'git-clone', repo: 'obra/superpowers', commit: 'b'.repeat(40), verified_at: '2026-01-01' },
    gsd: { install_strategy: 'npx', install_cmd: 'npx get-shit-done@latest', verified_at: '2026-01-01' },
    claudekit: { install_strategy: 'npx', install_cmd: 'npx claudekit@latest', verified_at: '2026-01-01' },
  },
  guard: { mode: 'block', patterns: 'strict' },
});

const V2_LOCK = JSON.stringify({
  schema_version: 2,
  acorn_version: '0.6.0',
  tools: {
    omc: { repo: 'test/omc', commit: 'a'.repeat(40), verified_at: '2026-01-01' },
    gstack: { repo: 'test/gstack', commit: 'b'.repeat(40), verified_at: '2026-01-01' },
    ecc: { repo: 'test/ecc', commit: 'c'.repeat(40), verified_at: '2026-01-01' },
  },
  guard: { mode: 'block', patterns: 'strict' },
});

function makeWorkspace(lockContent: string): { harnessRoot: string; lockPath: string } {
  const harnessRoot = mkdtempSync(join(tmpdir(), 'acorn-guided-test-'));
  const lockPath = join(harnessRoot, 'harness.lock');
  writeFileSync(lockPath, lockContent);
  return { harnessRoot, lockPath };
}

function fakeDetectEnv(installed: string[] = []): DetectEnv {
  return {
    harnessRoot: '/tmp/fake',
    dirExists: (p) => installed.some((name) => p.endsWith(name)),
    commandExists: (cmd) => installed.includes(cmd),
  };
}

// ── schemaV3 detection ────────────────────────────────────────────────────────

test('v3 lock → schemaV3=true', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv() });
  assert.equal(report.schemaV3, true);
  assert.equal(report.schemaVersion, 3);
});

test('v2 lock → schemaV3=false, empty detections', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V2_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv() });
  assert.equal(report.schemaV3, false);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.detections.length, 0);
});

// ── provider detection ────────────────────────────────────────────────────────

test('v3 guided: detections include all lock providers', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv() });
  const names = report.detections.map((d) => d.provider);
  assert.ok(names.includes('gstack'));
  assert.ok(names.includes('superpowers'));
  assert.ok(names.includes('gsd'));
  assert.ok(names.includes('claudekit'));
});

test('installed provider shows state=installed', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const env = fakeDetectEnv(['gstack']);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: env });
  const gstack = report.detections.find((d) => d.provider === 'gstack');
  assert.ok(gstack !== undefined);
  assert.equal(gstack.result.state, 'installed');
});

test('missing provider shows state=missing', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv() });
  const gstack = report.detections.find((d) => d.provider === 'gstack');
  assert.ok(gstack !== undefined);
  assert.equal(gstack.result.state, 'missing');
});

// ── profile and recommendations ───────────────────────────────────────────────

test('guided mode returns profile', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({
    lockPath, harnessRoot, detectEnv: fakeDetectEnv(),
    projectFiles: ['src/App.tsx'],
  });
  assert.ok(report.profile !== undefined);
  assert.equal(report.profile.hasUi, true);
});

test('guided mode returns recommendations', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv() });
  assert.ok(report.recommendations !== undefined);
  assert.ok(report.recommendations.capabilities.length > 0);
});

test('guided mode: hooks always in recommendations', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv() });
  assert.ok(report.recommendations !== undefined);
  const hooks = report.recommendations.capabilities.find((c) => c.capability === 'hooks');
  assert.ok(hooks !== undefined);
  assert.equal(hooks.priority, 'required');
});

// ── install plans ─────────────────────────────────────────────────────────────

test('guided mode: plans only for missing providers', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const env = fakeDetectEnv(['gstack']);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: env });
  assert.ok(report.plans !== undefined);
  const planProviders = report.plans.map((p) => p.provider);
  assert.ok(!planProviders.includes('gstack'), 'installed provider should not have a plan');
});

test('guided mode: plans have steps', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv() });
  assert.ok(report.plans !== undefined && report.plans.length > 0);
  for (const pp of report.plans) {
    assert.ok(pp.plan.steps.length > 0, `${pp.provider} plan has no steps`);
  }
});

test('no plans when all providers installed', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const env = fakeDetectEnv(['gstack', 'superpowers', 'gsd', 'claudekit']);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: env });
  assert.ok(report.plans !== undefined);
  assert.equal(report.plans.length, 0);
});

// ── rendering ─────────────────────────────────────────────────────────────────

test('renderGuidedReport: non-empty string', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv() });
  const rendered = renderGuidedReport(report);
  assert.ok(rendered.length > 0);
});

test('renderGuidedReport: includes provider names', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv() });
  const rendered = renderGuidedReport(report);
  assert.ok(rendered.includes('gstack'));
});

test('renderGuidedReport: v2 shows warning message', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V2_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv() });
  const rendered = renderGuidedReport(report);
  assert.ok(rendered.includes('v2'));
});

test('renderGuidedReport: includes schema version', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv() });
  const rendered = renderGuidedReport(report);
  assert.ok(rendered.includes('v3'));
});

// ── mode field ────────────────────────────────────────────────────────────────

test('mode defaults to guided', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv() });
  assert.equal(report.mode, 'guided');
});

test('explicit mode=guided', () => {
  const { harnessRoot, lockPath } = makeWorkspace(V3_LOCK);
  const report = runGuidedInstall({ lockPath, harnessRoot, detectEnv: fakeDetectEnv(), mode: 'guided' });
  assert.equal(report.mode, 'guided');
});
