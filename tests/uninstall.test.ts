import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  symlinkSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runUninstall } from '../src/commands/uninstall.ts';
import { runCli, EXIT } from '../src/index.ts';
import { renderPhaseBlock, PHASE_MARKER_START, PHASE_MARKER_END } from '../src/core/claude-md.ts';
import { ENV_KEYS } from '../src/core/env.ts';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'acorn-uninstall-test-'));
}

interface World {
  root: string;
  harnessRoot: string;
  claudeRoot: string;
  settingsPath: string;
  claudeMdPath: string;
  cleanup: () => void;
}

function makeWorld(): World {
  const root = tmpDir();
  const harnessRoot = join(root, 'harness');
  const claudeRoot = join(root, 'claude');
  mkdirSync(harnessRoot, { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  return {
    root,
    harnessRoot,
    claudeRoot,
    settingsPath: join(claudeRoot, 'settings.json'),
    claudeMdPath: join(claudeRoot, 'CLAUDE.md'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test('runUninstall: 빈 환경 → 모든 결과 absent/noop', () => {
  const w = makeWorld();
  try {
    const r = runUninstall({
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      claudeMdPath: w.claudeMdPath,
    });
    assert.deepEqual(r.settingsRemoved, []);
    assert.equal(r.claudeMd.kind, 'missing');
    assert.equal(r.symlink, 'absent');
    assert.equal(r.hookRemoved, false);
    assert.equal(r.markerRemoved, false);
    assert.equal(r.phaseTxtRemoved, false);
    assert.equal(r.vendorsRemoved, false);
  } finally {
    w.cleanup();
  }
});

test('runUninstall: vendors 존재 → 제거됨', () => {
  const w = makeWorld();
  try {
    const vRoot = join(w.harnessRoot, 'vendors');
    mkdirSync(join(vRoot, 'gstack'), { recursive: true });
    writeFileSync(join(vRoot, 'gstack', 'SKILL.md'), 'gstack content', 'utf8');

    const r = runUninstall({
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      claudeMdPath: w.claudeMdPath,
    });

    assert.equal(r.vendorsRemoved, true);
    assert.equal(existsSync(vRoot), false);
  } finally {
    w.cleanup();
  }
});

test('runUninstall: settings.json env 키 존재 → 제거됨 + 다른 키 보존', () => {
  const w = makeWorld();
  try {
    const settings = {
      env: {
        CLAUDE_PLUGIN_ROOT: '/some/path/vendors',
        OMC_PLUGIN_ROOT: '/some/path/vendors/omc',
        ECC_ROOT: '/some/path/vendors/ecc',
        KEEP_THIS: 'my-value',
      },
      someOtherSetting: true,
    };
    writeFileSync(w.settingsPath, JSON.stringify(settings, null, 2), 'utf8');

    const r = runUninstall({
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      claudeMdPath: w.claudeMdPath,
    });

    // All 3 ENV_KEYS removed
    assert.equal(r.settingsRemoved.length, 3);
    for (const key of ENV_KEYS) {
      assert.ok(r.settingsRemoved.includes(key), `${key} should be removed`);
    }

    // File updated
    const updated = JSON.parse(readFileSync(w.settingsPath, 'utf8')) as {
      env: Record<string, unknown>;
      someOtherSetting: boolean;
    };
    // ENV_KEYS gone
    for (const key of ENV_KEYS) {
      assert.equal(updated.env[key], undefined);
    }
    // Other keys preserved
    assert.equal(updated.env['KEEP_THIS'], 'my-value');
    assert.equal(updated.someOtherSetting, true);
  } finally {
    w.cleanup();
  }
});

test('runUninstall: settings.json env 키 없음 → noop', () => {
  const w = makeWorld();
  try {
    writeFileSync(w.settingsPath, JSON.stringify({ env: { KEEP: 'val' } }, null, 2), 'utf8');

    const r = runUninstall({
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      claudeMdPath: w.claudeMdPath,
    });

    assert.deepEqual(r.settingsRemoved, []);
    const updated = JSON.parse(readFileSync(w.settingsPath, 'utf8')) as { env: Record<string, unknown> };
    assert.equal(updated.env['KEEP'], 'val');
  } finally {
    w.cleanup();
  }
});

test('runUninstall: CLAUDE.md phase 마커 존재 → stripped', () => {
  const w = makeWorld();
  try {
    const block = renderPhaseBlock('dev');
    writeFileSync(w.claudeMdPath, `# Project\n\n${block}\n`, 'utf8');

    const r = runUninstall({
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      claudeMdPath: w.claudeMdPath,
    });

    assert.equal(r.claudeMd.kind, 'stripped');
    const content = readFileSync(w.claudeMdPath, 'utf8');
    assert.ok(!content.includes(PHASE_MARKER_START), 'START marker must be gone');
    assert.ok(!content.includes(PHASE_MARKER_END), 'END marker must be gone');
    assert.ok(content.includes('# Project'), 'content outside marker preserved');
  } finally {
    w.cleanup();
  }
});

test('runUninstall: CLAUDE.md corrupt 마커 → corrupt 결과 (파일 변경 없음)', () => {
  const w = makeWorld();
  try {
    const corruptContent = `# Project\n\n${PHASE_MARKER_START}\nno end marker\n`;
    writeFileSync(w.claudeMdPath, corruptContent, 'utf8');

    const r = runUninstall({
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      claudeMdPath: w.claudeMdPath,
    });

    assert.equal(r.claudeMd.kind, 'corrupt');
    // File must not be modified on corrupt
    const content = readFileSync(w.claudeMdPath, 'utf8');
    assert.equal(content, corruptContent);
  } finally {
    w.cleanup();
  }
});

test('runUninstall: gstack 심링크 존재 → removed', () => {
  const w = makeWorld();
  try {
    const symlinkDir = join(w.claudeRoot, 'skills');
    mkdirSync(symlinkDir, { recursive: true });
    const symlinkPath = join(symlinkDir, 'gstack');
    const target = join(w.harnessRoot, 'vendors', 'gstack');
    mkdirSync(target, { recursive: true });
    symlinkSync(target, symlinkPath);

    const r = runUninstall({
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      claudeMdPath: w.claudeMdPath,
    });

    assert.equal(r.symlink, 'removed');
    assert.equal(existsSync(symlinkPath), false);
  } finally {
    w.cleanup();
  }
});

test('runUninstall: gstack 심링크 absent → absent', () => {
  const w = makeWorld();
  try {
    const r = runUninstall({
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      claudeMdPath: w.claudeMdPath,
    });
    assert.equal(r.symlink, 'absent');
  } finally {
    w.cleanup();
  }
});

test('runUninstall: gstack 심링크가 심링크 아닌 디렉토리 → not_a_symlink (제거 안 함)', () => {
  const w = makeWorld();
  try {
    const symlinkDir = join(w.claudeRoot, 'skills');
    mkdirSync(symlinkDir, { recursive: true });
    const symlinkPath = join(symlinkDir, 'gstack');
    mkdirSync(symlinkPath, { recursive: true }); // real dir, not symlink

    const r = runUninstall({
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      claudeMdPath: w.claudeMdPath,
    });

    assert.equal(r.symlink, 'not_a_symlink');
    assert.equal(existsSync(symlinkPath), true); // NOT removed
  } finally {
    w.cleanup();
  }
});

test('runUninstall: phase.txt 존재 → 제거됨', () => {
  const w = makeWorld();
  try {
    const phasePath = join(w.harnessRoot, 'phase.txt');
    writeFileSync(phasePath, 'dev\n', 'utf8');

    const r = runUninstall({
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      claudeMdPath: w.claudeMdPath,
    });

    assert.equal(r.phaseTxtRemoved, true);
    assert.equal(existsSync(phasePath), false);
  } finally {
    w.cleanup();
  }
});

test('runUninstall: gstack marker 존재 → 제거됨', () => {
  const w = makeWorld();
  try {
    const markerPath = join(w.harnessRoot, '.gstack-setup.sha');
    writeFileSync(markerPath, 'a'.repeat(40) + '\n', 'utf8');

    const r = runUninstall({
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      claudeMdPath: w.claudeMdPath,
    });

    assert.equal(r.markerRemoved, true);
    assert.equal(existsSync(markerPath), false);
  } finally {
    w.cleanup();
  }
});

test('runUninstall: hooks/guard-check.sh 존재 → 제거됨', () => {
  const w = makeWorld();
  try {
    const hooksDir = join(w.harnessRoot, 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const hookPath = join(hooksDir, 'guard-check.sh');
    writeFileSync(hookPath, '#!/bin/bash\necho guard\n', 'utf8');

    const r = runUninstall({
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      claudeMdPath: w.claudeMdPath,
    });

    assert.equal(r.hookRemoved, true);
    assert.equal(existsSync(hookPath), false);
  } finally {
    w.cleanup();
  }
});

test('runUninstall: harness.lock 은 보존됨', () => {
  const w = makeWorld();
  try {
    const lockPath = join(w.harnessRoot, 'harness.lock');
    writeFileSync(lockPath, JSON.stringify({ schema_version: 2 }), 'utf8');

    runUninstall({
      harnessRoot: w.harnessRoot,
      claudeRoot: w.claudeRoot,
      settingsPath: w.settingsPath,
      claudeMdPath: w.claudeMdPath,
    });

    // harness.lock must survive uninstall
    assert.equal(existsSync(lockPath), true);
  } finally {
    w.cleanup();
  }
});

test('CLI cmdUninstall: non-TTY + no --yes → USAGE', () => {
  const c = {
    out: [] as string[],
    err: [] as string[],
    io: {
      stdout: (l: string) => c.out.push(l),
      stderr: (l: string) => c.err.push(l),
    },
  };
  // process.stdout.isTTY is false in test runner
  const code = runCli(['uninstall'], c.io);
  assert.equal(code, EXIT.USAGE);
  assert.ok(c.err.some((l) => /uninstall\/CONFIRM_REQUIRED/.test(l)));
});

test('CLI cmdUninstall: --yes + empty env → OK + summary', () => {
  const root = tmpDir();
  const harnessRoot = join(root, 'harness');
  const claudeRoot = join(root, 'claude');
  mkdirSync(harnessRoot, { recursive: true });
  mkdirSync(claudeRoot, { recursive: true });
  const settingsPath = join(claudeRoot, 'settings.json');
  const claudeMdPath = join(claudeRoot, 'CLAUDE.md');

  // Patch env so runUninstall uses our temp dirs
  const origHarness = process.env['ACORN_HARNESS_ROOT'];
  const origClaude = process.env['CLAUDE_CONFIG_DIR'];
  process.env['ACORN_HARNESS_ROOT'] = harnessRoot;
  process.env['CLAUDE_CONFIG_DIR'] = claudeRoot;

  try {
    const c = {
      out: [] as string[],
      err: [] as string[],
      io: {
        stdout: (l: string) => c.out.push(l),
        stderr: (l: string) => c.err.push(l),
      },
    };
    const code = runCli(['uninstall', '--yes'], c.io);
    assert.equal(code, EXIT.OK, `exit code should be OK, stderr: ${c.err.join('\n')}`);
    assert.ok(c.out.some((l) => l.includes('✅ uninstall 완료')));
    assert.ok(c.out.some((l) => l.includes('settings=')));
  } finally {
    if (origHarness === undefined) delete process.env['ACORN_HARNESS_ROOT'];
    else process.env['ACORN_HARNESS_ROOT'] = origHarness;
    if (origClaude === undefined) delete process.env['CLAUDE_CONFIG_DIR'];
    else process.env['CLAUDE_CONFIG_DIR'] = origClaude;
    rmSync(root, { recursive: true, force: true });
  }
});
