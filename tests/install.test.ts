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
import {
  runInstall,
  InstallError,
  defaultGstackSetup,
  verifyGstackSetupArtifacts,
} from '../src/commands/install.ts';
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
    // §15 H-1 (v0.3.4): 콜백 미제공 + marker 불일치 = silent no-op 경고 대상
    assert.equal(result.gstackSetupReason, 'no-callback');
  } finally {
    w.cleanup();
  }
});

test('§15 H-1 (v0.3.4): gstackSetupReason 4 상태 구분', () => {
  // ran / skip-flag / marker-noop / no-callback — cmdInstall 이 no-callback 만
  // ⚠️ 경고 대상으로 처리하므로 네 상태가 정확히 분류돼야 한다.
  const w = makeWorkspace();
  try {
    const git = makeFakeGit({ heads: new Map() });

    // A. 콜백 제공 + marker 없음 → ran
    const a = runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      gstackSetup: () => undefined,
    });
    assert.equal(a.gstackSetupReason, 'ran');
    assert.equal(a.gstackSetupRan, true);

    // B. 재실행 (marker 기록됨) → marker-noop
    const b = runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      gstackSetup: () => undefined,
    });
    assert.equal(b.gstackSetupReason, 'marker-noop');
    assert.equal(b.gstackSetupRan, false);

    // C. skipGstackSetup 명시 → skip-flag
    const c = runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      skipGstackSetup: true,
    });
    assert.equal(c.gstackSetupReason, 'skip-flag');
    assert.equal(c.gstackSetupRan, false);
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

test('verifyGstackSetupArtifacts: fingerprint 파일 모두 있으면 통과 (§15 C5)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-c5-ok-'));
  try {
    writeFileSync(join(dir, 'setup'), '#!/bin/sh\nexit 0\n', 'utf8');
    writeFileSync(join(dir, 'SKILL.md'), '# gstack\n', 'utf8');
    // 에러 없이 리턴해야 함
    verifyGstackSetupArtifacts(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyGstackSetupArtifacts: SKILL.md 누락 → 에러 + hint (§15 C5)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-c5-missing-'));
  try {
    writeFileSync(join(dir, 'setup'), '#!/bin/sh\nexit 0\n', 'utf8');
    // SKILL.md 누락 — setup 이 exit=0 이지만 artifact 없는 상황 시뮬레이션
    assert.throws(
      () => verifyGstackSetupArtifacts(dir),
      (e: unknown) =>
        e instanceof Error &&
        /SKILL\.md/.test(e.message) &&
        /shell 파싱|수동 실행/.test(e.message),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verifyGstackSetupArtifacts: setup 스크립트 누락 시 함께 보고', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-c5-both-'));
  try {
    // 둘 다 누락 — 에러 메시지에 둘 다 포함되어야 함
    assert.throws(
      () => verifyGstackSetupArtifacts(dir),
      (e: unknown) =>
        e instanceof Error &&
        /setup/.test(e.message) &&
        /SKILL\.md/.test(e.message),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('defaultGstackSetup: setup 스크립트 없으면 명확한 에러', () => {
  // DOGFOOD Round 1 §v0.1.1 #4: CLI 사용자용 기본 구현의 fail-close 검증.
  const dir = mkdtempSync(join(tmpdir(), 'acorn-gstack-noop-'));
  try {
    assert.throws(
      () => defaultGstackSetup({ gstackSource: dir, claudeRoot: dir }),
      (e: unknown) =>
        e instanceof Error &&
        /setup 스크립트 없음/.test(e.message) &&
        e.message.includes(dir),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
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
        // §15 S4 (v0.3.2): --adopt 를 1차 제안으로 포함해야 함 (discoverability).
        err.hint.includes('--adopt') &&
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
    assert.ok(lines.some((l) => l.includes('[1/8]')));
    assert.ok(lines.some((l) => l.includes('[7/8]')));
    assert.ok(lines.some((l) => l.includes('[8/8]')));
  } finally {
    w.cleanup();
  }
});

test('runInstall --adopt: non-git vendor → 이동 후 clone + preAdoptPath 반환 (§15 S4)', () => {
  const w = makeWorkspace();
  try {
    // vendors/omc 에 수동 설치된 non-git 디렉토리 시뮬
    const squatted = join(w.harnessRoot, 'vendors', 'omc');
    mkdirSync(squatted, { recursive: true });
    writeFileSync(join(squatted, 'manual.txt'), 'user stuff', 'utf8');

    const git = makeFakeGit({ heads: new Map() });
    const result = runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      skipGstackSetup: true,
      adopt: true,
    });
    assert.equal(result.vendors.omc.action, 'adopted');
    const preAdopt = result.vendors.omc.preAdoptPath;
    assert.ok(preAdopt, 'preAdoptPath 필드 존재');
    assert.ok(existsSync(preAdopt!));
    assert.equal(
      readFileSync(join(preAdopt!, 'manual.txt'), 'utf8'),
      'user stuff',
    );
    // 새 clone 이 원래 경로에 자리 잡음
    assert.ok(existsSync(join(squatted, '.git')));
  } finally {
    w.cleanup();
  }
});

test('runInstall --adopt: settings 충돌 → env.<key>.pre-adopt-<ts> 이동 + adopted action (§15 S4)', () => {
  const w = makeWorkspace();
  try {
    // 기존 settings 에 충돌하는 env 값 존재
    writeFileSync(
      w.settingsPath,
      JSON.stringify({
        theme: 'dark',
        env: {
          CLAUDE_PLUGIN_ROOT: '/wrong/path',
          OMC_PLUGIN_ROOT: '/wrong/omc',
          ECC_ROOT: '/wrong/ecc',
          MY_OWN_KEY: 'keep-me',
        },
      }),
    );
    const git = makeFakeGit({ heads: new Map() });
    const result = runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      skipGstackSetup: true,
      adopt: true,
    });
    assert.equal(result.settings.action, 'adopted');
    assert.ok(result.settings.movedKeys && result.settings.movedKeys.length === 3);
    const written = JSON.parse(readFileSync(w.settingsPath, 'utf8')) as {
      theme: string;
      env: Record<string, string>;
    };
    // 기대값으로 덮어쓰임
    assert.equal(written.env['CLAUDE_PLUGIN_ROOT'], join(w.harnessRoot, 'vendors'));
    // 기존 충돌 값이 pre-adopt 접미어로 보존됨
    const preserved = Object.keys(written.env).find((k) =>
      k.startsWith('CLAUDE_PLUGIN_ROOT.pre-adopt-'),
    );
    assert.ok(preserved, 'CLAUDE_PLUGIN_ROOT 의 pre-adopt 복사본 존재');
    assert.equal(written.env[preserved!], '/wrong/path');
    // 비-env 키 보존
    assert.equal(written.theme, 'dark');
    assert.equal(written.env['MY_OWN_KEY'], 'keep-me');
  } finally {
    w.cleanup();
  }
});

test('runInstall: settings 충돌 + --adopt 없음 → 여전히 SETTINGS_CONFLICT (regression guard)', () => {
  const w = makeWorkspace();
  try {
    writeFileSync(
      w.settingsPath,
      JSON.stringify({
        env: { CLAUDE_PLUGIN_ROOT: '/wrong', OMC_PLUGIN_ROOT: '/w', ECC_ROOT: '/w' },
      }),
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
          // adopt 미지정 (기본 false)
        }),
      (e: unknown) => e instanceof InstallError && e.code === 'SETTINGS_CONFLICT',
    );
  } finally {
    w.cleanup();
  }
});

test('runInstall: 빈 harness root → lock 템플릿 시드 + LOCK_SEEDED 에러 (§15 C1)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-c1-'));
  const harnessRoot = join(dir, 'harness-fresh');
  const claudeRoot = join(dir, 'claude');
  const lockPath = join(harnessRoot, 'harness.lock');
  mkdirSync(claudeRoot, { recursive: true });
  try {
    let caught: unknown = null;
    try {
      runInstall({
        lockPath,
        harnessRoot,
        claudeRoot,
        settingsPath: join(claudeRoot, 'settings.json'),
        git: makeFakeGit({ heads: new Map() }),
      });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof InstallError, 'InstallError 가 throw 되어야 함');
    assert.equal((caught as InstallError).code, 'LOCK_SEEDED');
    assert.ok(
      (caught as InstallError).hint?.includes('SHA'),
      'hint 에 SHA 교체 안내가 들어있어야 함',
    );
    // seed 가 실제로 파일을 만들었는지
    assert.ok(existsSync(lockPath), `lock 이 생성되어야 함: ${lockPath}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('runInstall: gstack setup 은 같은 SHA 에선 두 번째 install 에 재실행 안 함 (§15 C3)', () => {
  const w = makeWorkspace();
  try {
    const git = makeFakeGit({ heads: new Map() });
    let setupCalls = 0;
    const setupFn = () => {
      setupCalls++;
    };
    const first = runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      gstackSetup: setupFn,
    });
    assert.equal(setupCalls, 1, '첫 install 에선 setup 이 실행되어야 함');
    assert.equal(first.gstackSetupRan, true);

    const second = runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      gstackSetup: setupFn,
    });
    assert.equal(
      setupCalls,
      1,
      'SHA 동일 → 두 번째 install 에선 setup 재실행 안 함 (C3 regression guard)',
    );
    assert.equal(second.gstackSetupRan, false);
  } finally {
    w.cleanup();
  }
});

test('runInstall: hooks 배포 phase 추가 (§15 C2 / ADR-017)', () => {
  const w = makeWorkspace();
  try {
    const git = makeFakeGit({ heads: new Map() });
    const result = runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      skipGstackSetup: true,
    });
    // result 에 hooks 필드 포함
    assert.equal(result.hooks.action, 'created');
    // 실제 파일이 harnessRoot/hooks/guard-check.sh 로 배달됨
    assert.ok(
      existsSync(join(w.harnessRoot, 'hooks', 'guard-check.sh')),
      'install 이 guard-check.sh 를 디스크에 배달해야 함',
    );
  } finally {
    w.cleanup();
  }
});

test('runInstall: 멱등 2회차에선 hooks noop', () => {
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
    assert.equal(second.hooks.action, 'noop');
  } finally {
    w.cleanup();
  }
});

test('runInstall: 기존 lock 은 seed 가 건드리지 않음 (§15 C1 비파괴)', () => {
  const w = makeWorkspace();
  try {
    const originalLock = readFileSync(w.lockPath, 'utf8');
    const git = makeFakeGit({ heads: new Map() });
    // 정상 install 플로우. LOCK_SEEDED 가 아니어야 하고 lock 내용 불변이어야 함
    runInstall({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      git,
      skipGstackSetup: true,
    });
    assert.equal(
      readFileSync(w.lockPath, 'utf8'),
      originalLock,
      'seed 가 기존 lock 을 덮어쓰면 안 됨',
    );
  } finally {
    w.cleanup();
  }
});
