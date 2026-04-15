import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInstall, InstallError } from '../src/commands/install.ts';
import type { GitRunner } from '../src/core/vendors.ts';
import { beginTx, lastInProgress, txLogPath } from '../src/core/tx.ts';

const SHA_OMC = 'a'.repeat(40);
const SHA_GSTACK = 'b'.repeat(40);
const SHA_ECC = 'c'.repeat(40);

function makeLockJson(): string {
  return JSON.stringify(
    {
      schema_version: 1,
      acorn_version: '0.1.0',
      tools: {
        omc: { repo: 'org/omc', commit: SHA_OMC, verified_at: '2026-04-14' },
        gstack: { repo: 'org/gstack', commit: SHA_GSTACK, verified_at: '2026-04-14' },
        ecc: { repo: 'org/ecc', commit: SHA_ECC, verified_at: '2026-04-14' },
      },
      guard: { mode: 'block', patterns: 'strict' },
    },
    null,
    2,
  );
}

interface FakeGitState {
  heads: Map<string, string>;
}

function makeFakeGit(state: FakeGitState): GitRunner {
  return {
    clone(_repoUrl, dir) {
      mkdirSync(join(dir, '.git'), { recursive: true });
      writeFileSync(join(dir, 'README.md'), 'x', 'utf8');
      // initial head, will be overridden by checkout
      state.heads.set(dir, 'd'.repeat(40));
    },
    checkout(dir, commit) {
      state.heads.set(dir, commit);
    },
    revParse(dir) {
      const h = state.heads.get(dir);
      if (!h) throw new Error(`no head for ${dir}`);
      return h;
    },
    isGitRepo(dir) {
      return existsSync(join(dir, '.git'));
    },
    isDirty(_dir) {
      return false;
    },
  };
}

interface Workspace {
  dir: string;
  harnessRoot: string;
  claudeRoot: string;
  lockPath: string;
  settingsPath: string;
  cleanup: () => void;
}

function makeWorkspace(): Workspace {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-install-'));
  const harnessRoot = join(dir, 'harness');
  const claudeRoot = join(dir, 'claude');
  const lockPath = join(harnessRoot, 'harness.lock');
  const settingsPath = join(claudeRoot, 'settings.json');
  mkdirSync(harnessRoot, { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  writeFileSync(lockPath, makeLockJson(), 'utf8');
  return {
    dir,
    harnessRoot,
    claudeRoot,
    lockPath,
    settingsPath,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('runInstall: fresh 설치 end-to-end', () => {
  const w = makeWorkspace();
  try {
    const git = makeFakeGit({ heads: new Map() });
    let setupCalls = 0;
    const result = runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      gstackSetup: () => {
        setupCalls++;
      },
    });

    // vendors
    assert.equal(result.vendors.omc.action, 'cloned');
    assert.equal(result.vendors.gstack.action, 'cloned');
    assert.equal(result.vendors.ecc.action, 'cloned');
    assert.equal(result.vendors.omc.commit, SHA_OMC);

    // gstack symlink
    assert.equal(result.gstackSymlink.action, 'created');
    assert.equal(result.gstackSymlink.target, join(w.claudeRoot, 'skills', 'gstack'));

    // setup ran
    assert.equal(result.gstackSetupRan, true);
    assert.equal(setupCalls, 1);

    // settings
    assert.equal(result.settings.action, 'add');
    assert.deepEqual(
      [...result.settings.added].sort(),
      ['CLAUDE_PLUGIN_ROOT', 'ECC_ROOT', 'OMC_PLUGIN_ROOT'],
    );

    // vendors on disk
    assert.ok(existsSync(join(w.harnessRoot, 'vendors', 'omc', '.git')));
    assert.ok(existsSync(join(w.harnessRoot, 'vendors', 'gstack', '.git')));

    // settings.json written
    const written = JSON.parse(readFileSync(w.settingsPath, 'utf8')) as {
      env: Record<string, string>;
    };
    assert.equal(
      written.env['CLAUDE_PLUGIN_ROOT'],
      join(w.harnessRoot, 'vendors'),
    );
    assert.equal(
      written.env['OMC_PLUGIN_ROOT'],
      join(w.harnessRoot, 'vendors', 'omc'),
    );
  } finally {
    w.cleanup();
  }
});

test('runInstall: 멱등 — 두 번째 호출은 noop', () => {
  const w = makeWorkspace();
  try {
    const git = makeFakeGit({ heads: new Map() });
    runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      skipGstackSetup: true,
    });
    const second = runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      skipGstackSetup: true,
    });
    assert.equal(second.vendors.omc.action, 'noop');
    assert.equal(second.vendors.gstack.action, 'noop');
    assert.equal(second.vendors.ecc.action, 'noop');
    assert.equal(second.gstackSymlink.action, 'noop');
    assert.equal(second.settings.action, 'noop');
  } finally {
    w.cleanup();
  }
});

test('runInstall: settings 충돌 시 preflight 단계에서 중단 (vendors 변경 없음)', () => {
  const w = makeWorkspace();
  try {
    writeFileSync(
      w.settingsPath,
      JSON.stringify({
        env: {
          CLAUDE_PLUGIN_ROOT: '/wrong/path',
          OMC_PLUGIN_ROOT: '/wrong/omc',
          ECC_ROOT: '/wrong/ecc',
        },
      }),
      'utf8',
    );
    const git = makeFakeGit({ heads: new Map() });
    assert.throws(
      () =>
        runInstall({
          lockPath: w.lockPath,
          harnessRoot: w.harnessRoot,
          claudeRoot: w.claudeRoot,
          settingsPath: w.settingsPath,
          git,
          skipGstackSetup: true,
        }),
      (err: unknown) =>
        err instanceof InstallError &&
        err.code === 'SETTINGS_CONFLICT' &&
        typeof err.hint === 'string' &&
        err.hint.length > 0 &&
        /제거|수정/.test(err.hint),
    );
    // vendors not created
    assert.equal(existsSync(join(w.harnessRoot, 'vendors', 'omc')), false);
  } finally {
    w.cleanup();
  }
});

test('runInstall: gstackSetup 미제공 → gstackSetupRan=false', () => {
  const w = makeWorkspace();
  try {
    const git = makeFakeGit({ heads: new Map() });
    const result = runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
    });
    assert.equal(result.gstackSetupRan, false);
  } finally {
    w.cleanup();
  }
});

test('runInstall: skipGstackSetup → 콜백 호출 안 함', () => {
  const w = makeWorkspace();
  try {
    const git = makeFakeGit({ heads: new Map() });
    let called = false;
    const result = runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      skipGstackSetup: true,
      gstackSetup: () => {
        called = true;
      },
    });
    assert.equal(called, false);
    assert.equal(result.gstackSetupRan, false);
  } finally {
    w.cleanup();
  }
});

test('runInstall: 기존 settings.json 키 보존 + env만 추가', () => {
  const w = makeWorkspace();
  try {
    writeFileSync(
      w.settingsPath,
      JSON.stringify({
        theme: 'dark',
        model: 'sonnet',
        existingSection: { a: 1 },
      }),
      'utf8',
    );
    const git = makeFakeGit({ heads: new Map() });
    runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      skipGstackSetup: true,
    });
    const written = JSON.parse(readFileSync(w.settingsPath, 'utf8')) as {
      theme: string;
      model: string;
      existingSection: { a: number };
      env: Record<string, string>;
    };
    assert.equal(written.theme, 'dark');
    assert.equal(written.model, 'sonnet');
    assert.deepEqual(written.existingSection, { a: 1 });
    assert.ok(written.env['CLAUDE_PLUGIN_ROOT']);
  } finally {
    w.cleanup();
  }
});

test('runInstall: tx.log commit 마커 기록 + lastInProgress=null', () => {
  const w = makeWorkspace();
  try {
    const git = makeFakeGit({ heads: new Map() });
    runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      skipGstackSetup: true,
    });
    assert.equal(lastInProgress(w.harnessRoot), null);
    assert.ok(existsSync(txLogPath(w.harnessRoot)));
  } finally {
    w.cleanup();
  }
});

test('runInstall: 이전 tx 미완료 → IN_PROGRESS 에러', () => {
  const w = makeWorkspace();
  try {
    // 이전 tx 흔적 남김 (commit 없이 phase 까지만)
    const tx = beginTx(w.harnessRoot);
    tx.phase('vendors');
    const git = makeFakeGit({ heads: new Map() });
    assert.throws(
      () =>
        runInstall({
          lockPath: w.lockPath,
          harnessRoot: w.harnessRoot,
          claudeRoot: w.claudeRoot,
          settingsPath: w.settingsPath,
          git,
          skipGstackSetup: true,
        }),
      (err: unknown) =>
        err instanceof InstallError &&
        err.code === 'IN_PROGRESS' &&
        typeof err.hint === 'string' &&
        /tx\.log|--force/.test(err.hint),
    );
  } finally {
    w.cleanup();
  }
});

test('runInstall: force=true → IN_PROGRESS 우회', () => {
  const w = makeWorkspace();
  try {
    const tx = beginTx(w.harnessRoot);
    tx.phase('vendors');
    const git = makeFakeGit({ heads: new Map() });
    const r = runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      skipGstackSetup: true,
      force: true,
    });
    assert.equal(r.settings.action, 'add');
    assert.equal(lastInProgress(w.harnessRoot), null);
  } finally {
    w.cleanup();
  }
});

test('runInstall: 설치 중 실패 → tx.abort 기록 + lastInProgress=null', () => {
  const w = makeWorkspace();
  try {
    // settings 충돌로 실패 유도
    writeFileSync(
      w.settingsPath,
      JSON.stringify({
        env: { CLAUDE_PLUGIN_ROOT: '/other' },
      }),
      'utf8',
    );
    const git = makeFakeGit({ heads: new Map() });
    assert.throws(
      () =>
        runInstall({
          lockPath: w.lockPath,
          harnessRoot: w.harnessRoot,
          claudeRoot: w.claudeRoot,
          settingsPath: w.settingsPath,
          git,
          skipGstackSetup: true,
        }),
      (err: unknown) => err instanceof InstallError,
    );
    assert.equal(lastInProgress(w.harnessRoot), null);
  } finally {
    w.cleanup();
  }
});

test('runInstall: 기존 non-git 경로 → VENDOR 에러 + NOT_A_REPO hint', () => {
  // DOGFOOD Round 1 §v0.1.1 #3: install 에러에도 doctor 수준 next-action hint 필요.
  const w = makeWorkspace();
  try {
    // vendors/omc 에 git 저장소가 아닌 디렉토리 선점
    const squatted = join(w.harnessRoot, 'vendors', 'omc');
    mkdirSync(squatted, { recursive: true });
    writeFileSync(join(squatted, 'hello.txt'), 'not a repo', 'utf8');

    const git = makeFakeGit({ heads: new Map() });
    assert.throws(
      () =>
        runInstall({
          lockPath: w.lockPath,
          harnessRoot: w.harnessRoot,
          claudeRoot: w.claudeRoot,
          settingsPath: w.settingsPath,
          git,
          skipGstackSetup: true,
        }),
      (err: unknown) =>
        err instanceof InstallError &&
        err.code === 'VENDOR' &&
        typeof err.hint === 'string' &&
        /rm -rf|mv /.test(err.hint) &&
        err.hint.includes('vendors'),
    );
  } finally {
    w.cleanup();
  }
});

test('runInstall: logger 호출 (진행 추적)', () => {
  const w = makeWorkspace();
  try {
    const git = makeFakeGit({ heads: new Map() });
    const lines: string[] = [];
    runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      skipGstackSetup: true,
      logger: (line) => lines.push(line),
    });
    assert.ok(lines.some((l) => l.includes('[1/7]')));
    assert.ok(lines.some((l) => l.includes('[7/7]')));
  } finally {
    w.cleanup();
  }
});
