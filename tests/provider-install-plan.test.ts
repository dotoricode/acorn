import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { buildInstallPlan } from '../src/core/provider-install.ts';

const HARNESS = '/tmp/harness';
const CLAUDE = '/tmp/claude';

// ── gstack (clone strategy) ───────────────────────────────────────────────────

test('gstack plan uses clone strategy', () => {
  const plan = buildInstallPlan('gstack', { harnessRoot: HARNESS, claudeRoot: CLAUDE });
  assert.equal(plan.provider, 'gstack');
  assert.equal(plan.strategy, 'clone');
});

test('gstack plan has git-clone step with correct repo', () => {
  const plan = buildInstallPlan('gstack', { harnessRoot: HARNESS, claudeRoot: CLAUDE });
  const cloneStep = plan.steps.find((s) => s.kind === 'git-clone');
  assert.ok(cloneStep !== undefined, 'expected a git-clone step');
  assert.ok(cloneStep.command?.includes('garrytan/gstack'));
  assert.ok(cloneStep.command?.includes(HARNESS));
});

test('gstack plan includes symlink step', () => {
  const plan = buildInstallPlan('gstack', { harnessRoot: HARNESS, claudeRoot: CLAUDE });
  const symlinkStep = plan.steps.find((s) => s.kind === 'symlink');
  assert.ok(symlinkStep !== undefined, 'expected a symlink step');
  assert.ok(symlinkStep.from?.includes('gstack'));
  assert.ok(symlinkStep.to?.includes(CLAUDE));
});

// ── claudekit (npx strategy) ──────────────────────────────────────────────────

test('claudekit plan uses npx strategy', () => {
  const plan = buildInstallPlan('claudekit', { harnessRoot: HARNESS });
  assert.equal(plan.provider, 'claudekit');
  assert.equal(plan.strategy, 'npx');
});

test('claudekit plan has info and shell steps', () => {
  const plan = buildInstallPlan('claudekit', { harnessRoot: HARNESS });
  assert.ok(plan.steps.some((s) => s.kind === 'info'));
  assert.ok(plan.steps.some((s) => s.kind === 'shell'));
});

test('claudekit plan shell step references package name', () => {
  const plan = buildInstallPlan('claudekit', { harnessRoot: HARNESS });
  const shellStep = plan.steps.find((s) => s.kind === 'shell');
  assert.ok(shellStep?.command?.includes('@carlrannaberg/claudekit'));
});

test('claudekit plan has notes', () => {
  const plan = buildInstallPlan('claudekit', { harnessRoot: HARNESS });
  assert.ok(plan.notes !== undefined);
  assert.ok(plan.notes.includes('claudekit'));
});

// ── superpowers (clone strategy) ──────────────────────────────────────────────

test('superpowers plan uses clone strategy', () => {
  const plan = buildInstallPlan('superpowers', { harnessRoot: HARNESS });
  assert.equal(plan.strategy, 'clone');
});

test('superpowers plan git-clone step references obra/superpowers', () => {
  const plan = buildInstallPlan('superpowers', { harnessRoot: HARNESS });
  const cloneStep = plan.steps.find((s) => s.kind === 'git-clone');
  assert.ok(cloneStep?.command?.includes('obra/superpowers'));
});

// ── gsd (npx primary, clone available) ───────────────────────────────────────

test('gsd default plan uses npx', () => {
  const plan = buildInstallPlan('gsd', { harnessRoot: HARNESS });
  assert.equal(plan.strategy, 'npx');
});

test('gsd plan with preferStrategy clone uses clone', () => {
  const plan = buildInstallPlan('gsd', { harnessRoot: HARNESS, preferStrategy: 'clone' });
  assert.equal(plan.strategy, 'clone');
  const cloneStep = plan.steps.find((s) => s.kind === 'git-clone');
  assert.ok(cloneStep !== undefined);
  assert.ok(cloneStep.command?.includes('gsd-build/get-shit-done'));
});

// ── unknown provider ──────────────────────────────────────────────────────────

test('unknown provider produces manual plan', () => {
  const plan = buildInstallPlan('phantom-tool', { harnessRoot: HARNESS });
  assert.equal(plan.provider, 'phantom-tool');
  assert.equal(plan.strategy, 'manual');
  assert.ok(plan.steps.length > 0);
  assert.equal(plan.steps[0].kind, 'info');
  assert.ok(plan.steps[0].description.includes('phantom-tool'));
});

// ── plan structure invariants ─────────────────────────────────────────────────

test('every plan has at least one step', () => {
  for (const name of ['gstack', 'superpowers', 'gsd', 'claudekit']) {
    const plan = buildInstallPlan(name, { harnessRoot: HARNESS });
    assert.ok(plan.steps.length > 0, `${name} plan has no steps`);
  }
});

test('preferStrategy is ignored if not supported', () => {
  const plan = buildInstallPlan('gstack', {
    harnessRoot: HARNESS,
    preferStrategy: 'npx', // gstack only supports clone
  });
  assert.equal(plan.strategy, 'clone');
});
