import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readSettings,
  planMerge,
  mergeEnv,
  installEnv,
  backupSettings,
  atomicWriteJson,
  SettingsError,
} from '../src/core/settings.ts';
import type { EnvMap } from '../src/core/env.ts';

const DESIRED: EnvMap = {
  CLAUDE_PLUGIN_ROOT: '/h/vendors',
  OMC_PLUGIN_ROOT: '/h/vendors/omc',
  ECC_ROOT: '/h/vendors/ecc',
};

function makeWorkspace(): { dir: string; settingsPath: string; harnessRoot: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-settings-'));
  const harnessRoot = join(dir, 'harness');
  const settingsPath = join(dir, 'settings.json');
  return {
    dir,
    settingsPath,
    harnessRoot,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('readSettings: 파일 없으면 빈 객체', () => {
  const w = makeWorkspace();
  try {
    assert.deepEqual(readSettings(w.settingsPath), {});
  } finally {
    w.cleanup();
  }
});

test('readSettings: 빈 파일 → 빈 객체', () => {
  const w = makeWorkspace();
  try {
    writeFileSync(w.settingsPath, '', 'utf8');
    assert.deepEqual(readSettings(w.settingsPath), {});
  } finally {
    w.cleanup();
  }
});

test('readSettings: 잘못된 JSON → PARSE 에러', () => {
  const w = makeWorkspace();
  try {
    writeFileSync(w.settingsPath, '{bad', 'utf8');
    assert.throws(
      () => readSettings(w.settingsPath),
      (e: unknown) => e instanceof SettingsError && e.code === 'PARSE',
    );
  } finally {
    w.cleanup();
  }
});

test('readSettings: 루트가 array → PARSE 에러', () => {
  const w = makeWorkspace();
  try {
    writeFileSync(w.settingsPath, '[]', 'utf8');
    assert.throws(
      () => readSettings(w.settingsPath),
      (e: unknown) => e instanceof SettingsError && e.code === 'PARSE',
    );
  } finally {
    w.cleanup();
  }
});

test('planMerge: 빈 settings → action=add, toAdd=3', () => {
  const plan = planMerge({}, DESIRED);
  assert.equal(plan.action, 'add');
  assert.equal(plan.toAdd.length, 3);
  assert.equal(plan.conflicts.length, 0);
});

test('planMerge: env 모두 일치 → action=noop', () => {
  const plan = planMerge({ env: { ...DESIRED } }, DESIRED);
  assert.equal(plan.action, 'noop');
  assert.equal(plan.toAdd.length, 0);
});

test('planMerge: 다른 값 존재 → action=conflict', () => {
  const plan = planMerge(
    { env: { CLAUDE_PLUGIN_ROOT: '/wrong' } },
    DESIRED,
  );
  assert.equal(plan.action, 'conflict');
  assert.equal(plan.conflicts.length, 1);
  assert.equal(plan.conflicts[0]!.key, 'CLAUDE_PLUGIN_ROOT');
  assert.equal(plan.conflicts[0]!.current, '/wrong');
});

test('planMerge: env 일부만 있고 나머지 없음 → add', () => {
  const plan = planMerge(
    { env: { CLAUDE_PLUGIN_ROOT: DESIRED.CLAUDE_PLUGIN_ROOT } },
    DESIRED,
  );
  assert.equal(plan.action, 'add');
  assert.deepEqual([...plan.toAdd].sort(), ['ECC_ROOT', 'OMC_PLUGIN_ROOT']);
});

test('mergeEnv: 기존 다른 키는 보존', () => {
  const current = { theme: 'dark', env: { OTHER: 'x' } };
  const merged = mergeEnv(current, DESIRED);
  assert.equal((merged as any).theme, 'dark');
  assert.equal((merged as any).env.OTHER, 'x');
  assert.equal((merged as any).env.CLAUDE_PLUGIN_ROOT, DESIRED.CLAUDE_PLUGIN_ROOT);
});

test('mergeEnv: conflict 시 throw', () => {
  assert.throws(
    () => mergeEnv({ env: { CLAUDE_PLUGIN_ROOT: '/wrong' } }, DESIRED),
    (e: unknown) => e instanceof SettingsError && e.code === 'CONFLICT',
  );
});

test('atomicWriteJson: 새 파일 작성', () => {
  const w = makeWorkspace();
  try {
    atomicWriteJson(w.settingsPath, { theme: 'dark' });
    const round = JSON.parse(readFileSync(w.settingsPath, 'utf8'));
    assert.equal(round.theme, 'dark');
  } finally {
    w.cleanup();
  }
});

test('backupSettings: 파일 없으면 skipped=true', () => {
  const w = makeWorkspace();
  try {
    const r = backupSettings(w.settingsPath, w.harnessRoot);
    assert.equal(r.skipped, true);
    assert.equal(r.backupPath, null);
  } finally {
    w.cleanup();
  }
});

test('backupSettings: 파일 있으면 harness/backup/{ts}/settings.json.bak 생성', () => {
  const w = makeWorkspace();
  try {
    writeFileSync(w.settingsPath, '{"theme":"x"}', 'utf8');
    const r = backupSettings(w.settingsPath, w.harnessRoot);
    assert.equal(r.skipped, false);
    assert.ok(r.backupPath);
    assert.ok(existsSync(r.backupPath!));
    assert.equal(readFileSync(r.backupPath!, 'utf8'), '{"theme":"x"}');
    assert.ok(r.backupPath!.startsWith(join(w.harnessRoot, 'backup')));
  } finally {
    w.cleanup();
  }
});

test('installEnv: 빈 파일 → add + 백업 없음(원본 부재)', () => {
  const w = makeWorkspace();
  try {
    const r = installEnv({
      settingsPath: w.settingsPath,
      harnessRoot: w.harnessRoot,
      desired: DESIRED,
    });
    assert.equal(r.action, 'add');
    assert.equal(r.added.length, 3);
    assert.equal(r.backupPath, null);
    const written = JSON.parse(readFileSync(w.settingsPath, 'utf8'));
    assert.equal(written.env.CLAUDE_PLUGIN_ROOT, DESIRED.CLAUDE_PLUGIN_ROOT);
  } finally {
    w.cleanup();
  }
});

test('installEnv: 일치 → noop, 백업 없음, 파일 변경 없음', () => {
  const w = makeWorkspace();
  try {
    const original = JSON.stringify({ env: DESIRED, theme: 'x' }, null, 2) + '\n';
    writeFileSync(w.settingsPath, original, 'utf8');
    const r = installEnv({
      settingsPath: w.settingsPath,
      harnessRoot: w.harnessRoot,
      desired: DESIRED,
    });
    assert.equal(r.action, 'noop');
    assert.equal(r.backupPath, null);
    assert.equal(readFileSync(w.settingsPath, 'utf8'), original);
  } finally {
    w.cleanup();
  }
});

test('installEnv: 충돌 → CONFLICT throw, 파일 변경 없음, 백업 없음', () => {
  const w = makeWorkspace();
  try {
    const original = JSON.stringify({ env: { CLAUDE_PLUGIN_ROOT: '/wrong' } });
    writeFileSync(w.settingsPath, original, 'utf8');
    assert.throws(
      () =>
        installEnv({
          settingsPath: w.settingsPath,
          harnessRoot: w.harnessRoot,
          desired: DESIRED,
        }),
      (e: unknown) => e instanceof SettingsError && e.code === 'CONFLICT',
    );
    assert.equal(readFileSync(w.settingsPath, 'utf8'), original);
    assert.ok(!existsSync(join(w.harnessRoot, 'backup')));
  } finally {
    w.cleanup();
  }
});

test('installEnv: 부분 머지 → 기존 보존 + 백업 생성', () => {
  const w = makeWorkspace();
  try {
    const original = { theme: 'dark', env: { CLAUDE_PLUGIN_ROOT: DESIRED.CLAUDE_PLUGIN_ROOT } };
    writeFileSync(w.settingsPath, JSON.stringify(original), 'utf8');
    const r = installEnv({
      settingsPath: w.settingsPath,
      harnessRoot: w.harnessRoot,
      desired: DESIRED,
    });
    assert.equal(r.action, 'add');
    assert.deepEqual([...r.added].sort(), ['ECC_ROOT', 'OMC_PLUGIN_ROOT']);
    assert.ok(r.backupPath && existsSync(r.backupPath));
    const written = JSON.parse(readFileSync(w.settingsPath, 'utf8'));
    assert.equal(written.theme, 'dark');
    assert.equal(written.env.CLAUDE_PLUGIN_ROOT, DESIRED.CLAUDE_PLUGIN_ROOT);
    assert.equal(written.env.OMC_PLUGIN_ROOT, DESIRED.OMC_PLUGIN_ROOT);
    assert.equal(written.env.ECC_ROOT, DESIRED.ECC_ROOT);
    // 백업 디렉토리에 timestamp 폴더 1개
    const backupDir = join(w.harnessRoot, 'backup');
    assert.equal(readdirSync(backupDir).length, 1);
  } finally {
    w.cleanup();
  }
});

test('installEnv: 멱등성 — 두 번 호출해도 동일 결과', () => {
  const w = makeWorkspace();
  try {
    const r1 = installEnv({
      settingsPath: w.settingsPath,
      harnessRoot: w.harnessRoot,
      desired: DESIRED,
    });
    const after1 = readFileSync(w.settingsPath, 'utf8');
    const r2 = installEnv({
      settingsPath: w.settingsPath,
      harnessRoot: w.harnessRoot,
      desired: DESIRED,
    });
    assert.equal(r1.action, 'add');
    assert.equal(r2.action, 'noop');
    assert.equal(readFileSync(w.settingsPath, 'utf8'), after1);
  } finally {
    w.cleanup();
  }
});
