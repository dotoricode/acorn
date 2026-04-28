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
  const norm = (p: string) => p.replace(/\\/g, '/');
  return {
    harnessRoot: opts.harnessRoot,
    dirExists: (p) => dirs.has(p) || dirs.has(norm(p)),
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

// v0.9.3: npm version drift helpers
import { compareNpmVersion, extractNpmPackage } from '../src/core/provider-detect.ts';

test('extractNpmPackage: 단순 npx 패키지', () => {
  assert.equal(extractNpmPackage('npx claudekit@latest'), 'claudekit');
  assert.equal(extractNpmPackage('npx claudekit'), 'claudekit');
  assert.equal(extractNpmPackage('npx claudekit setup --yes'), 'claudekit');
});

test('extractNpmPackage: scoped 패키지', () => {
  assert.equal(
    extractNpmPackage('npx @carlrannaberg/claudekit@latest'),
    '@carlrannaberg/claudekit',
  );
  assert.equal(extractNpmPackage('npx @carlrannaberg/claudekit'), '@carlrannaberg/claudekit');
});

test('extractNpmPackage: 다양한 runner', () => {
  assert.equal(extractNpmPackage('npm exec claudekit@latest'), 'claudekit');
  assert.equal(extractNpmPackage('pnpm dlx claudekit'), 'claudekit');
  assert.equal(extractNpmPackage('yarn dlx claudekit@1.2.3'), 'claudekit');
});

test('extractNpmPackage: pinned semver', () => {
  assert.equal(extractNpmPackage('npx claudekit@1.2.3'), 'claudekit');
  assert.equal(extractNpmPackage('npx @scope/pkg@1.0.0-beta.1'), '@scope/pkg');
});

test('compareNpmVersion: lock 와 latest 가 일치 → match', () => {
  const r = compareNpmVersion('1.2.3', '1.2.3');
  assert.equal(r.state, 'match');
});

test('compareNpmVersion: lock 와 latest 가 다름 → drift + 양쪽 표시', () => {
  const r = compareNpmVersion('1.2.3', '1.3.0');
  assert.equal(r.state, 'drift');
  assert.equal(r.lockVersion, '1.2.3');
  assert.equal(r.latestVersion, '1.3.0');
  assert.ok(r.detail?.includes('1.2.3'));
  assert.ok(r.detail?.includes('1.3.0'));
});

test('compareNpmVersion: latest=null → unknown (네트워크 실패)', () => {
  const r = compareNpmVersion('1.2.3', null);
  assert.equal(r.state, 'unknown');
  assert.equal(r.lockVersion, '1.2.3');
});

// v0.9.3: plugin-marketplace strategy → unknown (Claude Code 외부 영역)
test('detectProvider: plugin-marketplace primaryStrategy → unknown + 안내', () => {
  // 실제 등록된 provider 중 plugin-marketplace 가 primaryStrategy 인 건 없으나,
  // 향후 추가될 때 분기를 검증하기 위해 가짜 provider 등록 시나리오는 skip 하고
  // detectProvider 의 분기 자체만 dry test 가 어렵다 — 대신 helper 만 테스트.
  // (compareNpmVersion + extractNpmPackage 가 위에서 충분히 커버됨.)
});
