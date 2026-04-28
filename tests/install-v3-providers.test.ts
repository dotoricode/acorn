process.env['ACORN_ALLOW_ANY_REPO'] = '1';

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  collectActiveProviders,
  executeV3Providers,
  type NpxRunner,
  type ProviderExecResult,
} from '../src/core/provider-execute.ts';
import { runInstall } from '../src/commands/install.ts';
import type { GitRunner } from '../src/core/vendors.ts';
import type { HarnessLockV3 } from '../src/core/lock.ts';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const ZERO_SHA = '0'.repeat(40);

// ── helpers ────────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'acorn-v3-'));
}

function makeFakeGit(heads: Map<string, string>): GitRunner {
  return {
    clone(_url, dir) {
      mkdirSync(join(dir, '.git'), { recursive: true });
      writeFileSync(join(dir, 'README.md'), 'x');
      heads.set(dir, 'd'.repeat(40));
    },
    checkout(dir, commit) {
      heads.set(dir, commit);
    },
    revParse(dir) {
      return heads.get(dir) ?? 'f'.repeat(40);
    },
    isGitRepo(dir) {
      return existsSync(join(dir, '.git'));
    },
    isDirty(_dir) {
      return false;
    },
  };
}

function recordingNpxRunner(): NpxRunner & { ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    run(cmd: string) {
      ran.push(cmd);
    },
  };
}

function makeV3Lock(overrides: Partial<HarnessLockV3> = {}): HarnessLockV3 {
  return {
    schema_version: 3,
    acorn_version: '0.9.0',
    capabilities: {
      hooks: { providers: ['claudekit'] },
      tdd: { providers: ['gstack'] },
    },
    providers: {
      gstack: {
        install_strategy: 'git-clone',
        repo: 'org/gstack',
        commit: SHA_A,
        verified_at: '2026-01-01',
      },
      claudekit: {
        install_strategy: 'npx',
        install_cmd: 'npx claudekit@latest',
        verified_at: '2026-01-01',
      },
    },
    guard: { mode: 'block', patterns: 'strict' },
    ...overrides,
  };
}

function makeV3LockJson(lock: HarnessLockV3 = makeV3Lock()): string {
  return JSON.stringify(lock, null, 2);
}

// ── collectActiveProviders ────────────────────────────────────────────────────

test('collectActiveProviders: returns all providers referenced in capabilities', () => {
  const lock = makeV3Lock();
  const active = collectActiveProviders(lock);
  assert.deepEqual([...active].sort(), ['claudekit', 'gstack']);
});

test('collectActiveProviders: empty capabilities → empty set', () => {
  const lock = makeV3Lock({ capabilities: {} });
  const active = collectActiveProviders(lock);
  assert.equal(active.size, 0);
});

test('collectActiveProviders: deduplicates when provider appears in multiple capabilities', () => {
  const lock = makeV3Lock({
    capabilities: {
      planning: { providers: ['gstack'] },
      review: { providers: ['gstack'] },
    },
  });
  const active = collectActiveProviders(lock);
  assert.equal(active.size, 1);
  assert.ok(active.has('gstack'));
});

// ── executeV3Providers: git-clone ─────────────────────────────────────────────

test('executeV3Providers: git-clone provider → action=cloned', () => {
  const harnessRoot = makeTmpDir();
  try {
    const lock = makeV3Lock({
      capabilities: { tdd: { providers: ['gstack'] } },
      providers: {
        gstack: {
          install_strategy: 'git-clone',
          repo: 'org/gstack',
          commit: SHA_A,
          verified_at: '2026-01-01',
        },
      },
    });
    const heads = new Map<string, string>();
    const fakeGit = makeFakeGit(heads);
    const logs: string[] = [];
    const results = executeV3Providers(lock, {
      harnessRoot,
      git: fakeGit,
      log: (l) => logs.push(l),
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'gstack');
    assert.equal(results[0].action, 'cloned');
    assert.equal(results[0].commit, SHA_A);
  } finally {
    rmSync(harnessRoot, { recursive: true, force: true });
  }
});

test('executeV3Providers: git-clone noop on second call', () => {
  const harnessRoot = makeTmpDir();
  try {
    const lock = makeV3Lock({
      capabilities: { tdd: { providers: ['gstack'] } },
      providers: {
        gstack: {
          install_strategy: 'git-clone',
          repo: 'org/gstack',
          commit: SHA_A,
          verified_at: '2026-01-01',
        },
      },
    });
    const heads = new Map<string, string>();
    const fakeGit = makeFakeGit(heads);
    const logs: string[] = [];
    executeV3Providers(lock, { harnessRoot, git: fakeGit, log: (l) => logs.push(l) });
    const results2 = executeV3Providers(lock, { harnessRoot, git: fakeGit, log: (l) => logs.push(l) });
    assert.equal(results2[0].action, 'noop');
  } finally {
    rmSync(harnessRoot, { recursive: true, force: true });
  }
});

test('executeV3Providers: placeholder SHA → action=skipped-placeholder', () => {
  const harnessRoot = makeTmpDir();
  try {
    const lock = makeV3Lock({
      capabilities: { tdd: { providers: ['gstack'] } },
      providers: {
        gstack: {
          install_strategy: 'git-clone',
          repo: 'org/gstack',
          commit: ZERO_SHA,
          verified_at: '2026-01-01',
        },
      },
    });
    const heads = new Map<string, string>();
    const fakeGit = makeFakeGit(heads);
    const logs: string[] = [];
    const results = executeV3Providers(lock, {
      harnessRoot,
      git: fakeGit,
      log: (l) => logs.push(l),
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].action, 'skipped-placeholder');
  } finally {
    rmSync(harnessRoot, { recursive: true, force: true });
  }
});

// ── executeV3Providers: npx ────────────────────────────────────────────────────

test('executeV3Providers: npx provider → action=npx-ran, command recorded', () => {
  const harnessRoot = makeTmpDir();
  try {
    const lock = makeV3Lock({
      capabilities: { hooks: { providers: ['claudekit'] } },
      providers: {
        claudekit: {
          install_strategy: 'npx',
          install_cmd: 'npx claudekit@latest',
          verified_at: '2026-01-01',
        },
      },
    });
    const npx = recordingNpxRunner();
    const heads = new Map<string, string>();
    const fakeGit = makeFakeGit(heads);
    const logs: string[] = [];
    const results = executeV3Providers(lock, {
      harnessRoot,
      git: fakeGit,
      npxRunner: npx,
      log: (l) => logs.push(l),
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'claudekit');
    assert.equal(results[0].action, 'npx-ran');
    assert.equal(results[0].detail, 'npx claudekit@latest');
    assert.deepEqual(npx.ran, ['npx claudekit@latest']);
  } finally {
    rmSync(harnessRoot, { recursive: true, force: true });
  }
});

test('executeV3Providers: inactive provider (not in capabilities) is skipped', () => {
  const harnessRoot = makeTmpDir();
  try {
    const lock = makeV3Lock({
      capabilities: { hooks: { providers: ['claudekit'] } },
      providers: {
        claudekit: {
          install_strategy: 'npx',
          install_cmd: 'npx claudekit@latest',
          verified_at: '2026-01-01',
        },
        gstack: {
          install_strategy: 'git-clone',
          repo: 'org/gstack',
          commit: SHA_A,
          verified_at: '2026-01-01',
        },
      },
    });
    const npx = recordingNpxRunner();
    const heads = new Map<string, string>();
    const fakeGit = makeFakeGit(heads);
    const logs: string[] = [];
    const results = executeV3Providers(lock, {
      harnessRoot,
      git: fakeGit,
      npxRunner: npx,
      log: (l) => logs.push(l),
    });
    // gstack is in providers but not in capabilities → skipped
    assert.equal(results.length, 1);
    assert.equal(results[0].provider, 'claudekit');
    // gstack dir should NOT exist
    const gstackPath = join(harnessRoot, 'vendors', 'gstack');
    assert.equal(existsSync(gstackPath), false);
  } finally {
    rmSync(harnessRoot, { recursive: true, force: true });
  }
});

test('executeV3Providers: npx failure throws descriptive error', () => {
  const harnessRoot = makeTmpDir();
  try {
    const lock = makeV3Lock({
      capabilities: { hooks: { providers: ['claudekit'] } },
      providers: {
        claudekit: {
          install_strategy: 'npx',
          install_cmd: 'npx claudekit@latest',
          verified_at: '2026-01-01',
        },
      },
    });
    const failingNpx: NpxRunner = {
      run(_cmd: string) {
        throw new Error('network error');
      },
    };
    const heads = new Map<string, string>();
    const fakeGit = makeFakeGit(heads);
    assert.throws(
      () => executeV3Providers(lock, { harnessRoot, git: fakeGit, npxRunner: failingNpx, log: () => undefined }),
      (err: Error) => {
        assert.ok(err.message.includes('claudekit'));
        assert.ok(err.message.includes('network error'));
        return true;
      },
    );
  } finally {
    rmSync(harnessRoot, { recursive: true, force: true });
  }
});

// ── runInstall with v3 lock ───────────────────────────────────────────────────

test('runInstall: v3 lock → executes providers, returns v3Providers', () => {
  const harnessRoot = makeTmpDir();
  const claudeRoot = makeTmpDir();
  const settingsPath = join(makeTmpDir(), 'settings.json');
  const lockPath = join(harnessRoot, 'harness.lock');

  try {
    mkdirSync(harnessRoot, { recursive: true });
    // v3 lock with gstack (git-clone) + claudekit (npx)
    const lock = makeV3Lock();
    writeFileSync(lockPath, makeV3LockJson(lock));

    const heads = new Map<string, string>();
    // Make gstack dir look like it also has SKILL.md (for setup verification)
    const origClone = (dir: string, _url?: string) => {
      mkdirSync(join(dir, '.git'), { recursive: true });
      writeFileSync(join(dir, 'README.md'), 'x');
      writeFileSync(join(dir, 'SKILL.md'), 'x');
      writeFileSync(join(dir, 'setup'), '#!/bin/bash\n');
      heads.set(dir, SHA_A);
    };
    const fakeGit: GitRunner = {
      clone(url, dir) { origClone(dir, url); },
      checkout(dir, commit) { heads.set(dir, commit); },
      revParse(dir) { return heads.get(dir) ?? SHA_A; },
      isGitRepo(dir) { return existsSync(join(dir, '.git')); },
      isDirty(_dir) { return false; },
    };
    const npx = recordingNpxRunner();

    const result = runInstall({
      lockPath,
      harnessRoot,
      claudeRoot,
      settingsPath,
      git: fakeGit,
      skipGstackSetup: true,
      skipClaudeMd: true,
      logger: () => undefined,
      npxRunner: npx,
    });

    assert.ok(result.v3Providers, 'v3Providers should be set');
    assert.equal(result.v3Providers!.length, 2);

    const gstackResult = result.v3Providers!.find((r) => r.provider === 'gstack');
    assert.ok(gstackResult, 'gstack result missing');
    assert.equal(gstackResult!.action, 'cloned');

    const claudekitResult = result.v3Providers!.find((r) => r.provider === 'claudekit');
    assert.ok(claudekitResult, 'claudekit result missing');
    assert.equal(claudekitResult!.action, 'npx-ran');

    // npx should have been called with claudekit cmd
    assert.ok(npx.ran.some((cmd) => cmd.includes('claudekit')));
  } finally {
    rmSync(harnessRoot, { recursive: true, force: true });
    rmSync(claudeRoot, { recursive: true, force: true });
    rmSync(dirname(settingsPath), { recursive: true, force: true });
  }
});

test('runInstall: v3 lock with only placeholder SHAs → all git-clone providers skipped-placeholder', () => {
  const harnessRoot = makeTmpDir();
  const claudeRoot = makeTmpDir();
  const settingsPath = join(makeTmpDir(), 'settings.json');
  const lockPath = join(harnessRoot, 'harness.lock');

  try {
    mkdirSync(harnessRoot, { recursive: true });
    const lock = makeV3Lock({
      capabilities: { tdd: { providers: ['gstack'] } },
      providers: {
        gstack: {
          install_strategy: 'git-clone',
          repo: 'org/gstack',
          commit: ZERO_SHA,
          verified_at: '2026-01-01',
        },
      },
    });
    writeFileSync(lockPath, makeV3LockJson(lock));

    const heads = new Map<string, string>();
    const fakeGit = makeFakeGit(heads);
    const npx = recordingNpxRunner();

    const result = runInstall({
      lockPath,
      harnessRoot,
      claudeRoot,
      settingsPath,
      git: fakeGit,
      skipGstackSetup: true,
      skipClaudeMd: true,
      logger: () => undefined,
      npxRunner: npx,
    });

    assert.ok(result.v3Providers);
    assert.equal(result.v3Providers!.length, 1);
    assert.equal(result.v3Providers![0].action, 'skipped-placeholder');
  } finally {
    rmSync(harnessRoot, { recursive: true, force: true });
    rmSync(claudeRoot, { recursive: true, force: true });
    rmSync(dirname(settingsPath), { recursive: true, force: true });
  }
});

test('runInstall: v2 lock still works (backward compat)', () => {
  const harnessRoot = makeTmpDir();
  const claudeRoot = makeTmpDir();
  const settingsPath = join(makeTmpDir(), 'settings.json');
  const lockPath = join(harnessRoot, 'harness.lock');

  try {
    mkdirSync(harnessRoot, { recursive: true });
    writeFileSync(
      lockPath,
      JSON.stringify({
        schema_version: 2,
        acorn_version: '0.8.0',
        tools: {
          omc: { repo: 'org/omc', commit: SHA_A, verified_at: '2026-01-01' },
          gstack: { repo: 'org/gstack', commit: SHA_B, verified_at: '2026-01-01' },
          ecc: { repo: 'org/ecc', commit: SHA_A, verified_at: '2026-01-01' },
        },
        guard: { mode: 'block', patterns: 'strict' },
      }),
    );

    const heads = new Map<string, string>();
    const fakeGit: GitRunner = {
      clone(_url, dir) {
        mkdirSync(join(dir, '.git'), { recursive: true });
        writeFileSync(join(dir, 'README.md'), 'x');
        writeFileSync(join(dir, 'SKILL.md'), 'x');
        writeFileSync(join(dir, 'setup'), '#!/bin/bash\n');
        heads.set(dir, SHA_A);
      },
      checkout(dir, commit) { heads.set(dir, commit); },
      revParse(dir) { return heads.get(dir) ?? SHA_A; },
      isGitRepo(dir) { return existsSync(join(dir, '.git')); },
      isDirty(_dir) { return false; },
    };

    const result = runInstall({
      lockPath,
      harnessRoot,
      claudeRoot,
      settingsPath,
      git: fakeGit,
      skipGstackSetup: true,
      skipClaudeMd: true,
      logger: () => undefined,
    });

    // v2 result: no v3Providers, has vendors
    assert.equal(result.v3Providers, undefined);
    assert.ok(result.vendors.gstack, 'v2 vendors.gstack should exist');
  } finally {
    rmSync(harnessRoot, { recursive: true, force: true });
    rmSync(claudeRoot, { recursive: true, force: true });
    rmSync(dirname(settingsPath), { recursive: true, force: true });
  }
});

// v0.9.2: plugin-marketplace strategy → plugin-guidance action (no execute)
test('executeV3Providers: plugin-marketplace → plugin-guidance action + 안내 detail', () => {
  const harnessRoot = makeTmpDir();
  try {
    const lock: HarnessLockV3 = {
      schema_version: 3,
      acorn_version: '0.9.2',
      capabilities: { planning: { providers: ['superpowers'] } },
      providers: {
        superpowers: {
          install_strategy: 'plugin-marketplace',
          marketplace: 'obra/superpowers-marketplace',
          plugin: 'superpowers',
          verified_at: '2026-04-28',
        },
      },
      guard: { mode: 'block', patterns: 'moderate' },
    };

    let npxCalled = false;
    const noopNpx: NpxRunner = { run: () => { npxCalled = true; } };
    const heads = new Map<string, string>();
    const logs: string[] = [];

    const results = executeV3Providers(lock, {
      harnessRoot,
      git: makeFakeGit(heads),
      npxRunner: noopNpx,
      log: (l) => logs.push(l),
    }) as readonly ProviderExecResult[];

    assert.equal(npxCalled, false, 'plugin-marketplace 는 npx 를 실행하지 않아야 함');
    const sp = results.find((r) => r.provider === 'superpowers');
    assert.ok(sp, 'superpowers 결과가 있어야 함');
    assert.equal(sp?.action, 'plugin-guidance');
    assert.ok(sp?.detail?.includes('/plugin install superpowers@obra/superpowers-marketplace'));
    assert.ok(logs.some((l) => /plugin marketplace/.test(l)));
  } finally {
    rmSync(harnessRoot, { recursive: true, force: true });
  }
});
