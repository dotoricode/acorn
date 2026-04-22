import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { listProviders, getProvider, findProvidersByCapability } from '../src/core/providers.ts';
import { detectProvider, type DetectEnv } from '../src/core/provider-detect.ts';

// ── registry ─────────────────────────────────────────────────────────────────

test('listProviders returns 4 known providers', () => {
  const providers = listProviders();
  assert.equal(providers.length, 4);
  const names = providers.map((p) => p.name);
  assert.ok(names.includes('gstack'));
  assert.ok(names.includes('superpowers'));
  assert.ok(names.includes('gsd'));
  assert.ok(names.includes('claudekit'));
});

test('getProvider returns def for known name', () => {
  const p = getProvider('gstack');
  assert.ok(p !== undefined);
  assert.equal(p.name, 'gstack');
  assert.equal(p.primaryStrategy, 'clone');
  assert.equal(p.repo, 'garrytan/gstack');
});

test('getProvider returns undefined for unknown name', () => {
  assert.equal(getProvider('nonexistent'), undefined);
});

test('gstack hooks capability is primary', () => {
  const p = getProvider('gstack');
  assert.ok(p !== undefined);
  const hooksCap = p.capabilities.find((c) => c.name === 'hooks');
  assert.ok(hooksCap !== undefined);
  assert.equal(hooksCap.strength, 'primary');
});

test('superpowers planning capability is primary', () => {
  const p = getProvider('superpowers');
  assert.ok(p !== undefined);
  const planCap = p.capabilities.find((c) => c.name === 'planning');
  assert.ok(planCap !== undefined);
  assert.equal(planCap.strength, 'primary');
});

test('claudekit has npx as primary strategy', () => {
  const p = getProvider('claudekit');
  assert.ok(p !== undefined);
  assert.equal(p.primaryStrategy, 'npx');
  assert.equal(p.command, 'claudekit');
});

test('gsd supports both npx and clone strategies', () => {
  const p = getProvider('gsd');
  assert.ok(p !== undefined);
  assert.ok(p.strategies.includes('npx'));
  assert.ok(p.strategies.includes('clone'));
  assert.equal(p.primaryStrategy, 'npx');
});

// ── findProvidersByCapability ─────────────────────────────────────────────────

test('findProvidersByCapability hooks returns gstack and claudekit', () => {
  const providers = findProvidersByCapability('hooks');
  const names = providers.map((p) => p.name);
  assert.ok(names.includes('gstack'));
  assert.ok(names.includes('claudekit'));
});

test('findProvidersByCapability hooks primary-only returns gstack and claudekit', () => {
  const providers = findProvidersByCapability('hooks', 'primary');
  const names = providers.map((p) => p.name);
  assert.ok(names.includes('gstack'));
  assert.ok(names.includes('claudekit'));
  // both have hooks as primary
  for (const p of providers) {
    const hooksCap = p.capabilities.find((c) => c.name === 'hooks');
    assert.ok(hooksCap !== undefined);
    assert.equal(hooksCap.strength, 'primary');
  }
});

test('findProvidersByCapability planning primary-only returns gstack not found, superpowers and gsd found', () => {
  const providers = findProvidersByCapability('planning', 'primary');
  const names = providers.map((p) => p.name);
  assert.ok(!names.includes('gstack'));
  assert.ok(names.includes('superpowers'));
  assert.ok(names.includes('gsd'));
});

// ── detectProvider ────────────────────────────────────────────────────────────

function makeEnv(opts: {
  harnessRoot: string;
  existingDirs?: string[];
  existingCmds?: string[];
}): DetectEnv {
  const dirs = new Set(opts.existingDirs ?? []);
  const cmds = new Set(opts.existingCmds ?? []);
  return {
    harnessRoot: opts.harnessRoot,
    dirExists: (p) => dirs.has(p),
    commandExists: (cmd) => cmds.has(cmd),
  };
}

test('detect gstack installed when vendor dir exists', () => {
  const harnessRoot = '/tmp/harness';
  const env = makeEnv({
    harnessRoot,
    existingDirs: [`${harnessRoot}/vendors/gstack`],
  });
  const result = detectProvider('gstack', env);
  assert.equal(result.state, 'installed');
  assert.ok(result.detail?.includes('gstack'));
});

test('detect gstack missing when vendor dir absent', () => {
  const env = makeEnv({ harnessRoot: '/tmp/harness' });
  const result = detectProvider('gstack', env);
  assert.equal(result.state, 'missing');
  assert.equal(result.detail, undefined);
});

test('detect superpowers installed when vendor dir exists', () => {
  const harnessRoot = '/tmp/harness';
  const env = makeEnv({
    harnessRoot,
    existingDirs: [`${harnessRoot}/vendors/superpowers`],
  });
  const result = detectProvider('superpowers', env);
  assert.equal(result.state, 'installed');
});

test('detect claudekit installed when command in PATH', () => {
  const env = makeEnv({ harnessRoot: '/tmp/harness', existingCmds: ['claudekit'] });
  const result = detectProvider('claudekit', env);
  assert.equal(result.state, 'installed');
  assert.ok(result.detail?.includes('claudekit'));
});

test('detect claudekit missing when command absent', () => {
  const env = makeEnv({ harnessRoot: '/tmp/harness' });
  const result = detectProvider('claudekit', env);
  assert.equal(result.state, 'missing');
});

test('detect gsd installed when gsd command in PATH', () => {
  const env = makeEnv({ harnessRoot: '/tmp/harness', existingCmds: ['gsd'] });
  const result = detectProvider('gsd', env);
  assert.equal(result.state, 'installed');
});

test('detect unknown provider returns unknown state', () => {
  const env = makeEnv({ harnessRoot: '/tmp/harness' });
  const result = detectProvider('nonexistent', env);
  assert.equal(result.state, 'unknown');
  assert.ok(result.detail?.includes('registry'));
});
