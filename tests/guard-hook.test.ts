// §15 HIGH-2 / ADR-020 (v0.4.0): 가짜 repo 사용 — allowlist bypass.
process.env['ACORN_ALLOW_ANY_REPO'] = '1';

/**
 * §15 H1 (v0.2.0): harness.lock.guard.patterns 가 실제로 hook 차단 행동을
 * 바꾸는지 검증한다. 이전엔 dead config 였음.
 *
 * bash 가 없는 환경에서는 skip (Windows 에서 Git Bash 설치 안 된 CI 등).
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packagedHookPath } from '../src/core/hooks.ts';

const SHA = 'a'.repeat(40);

function bashAvailable(): boolean {
  const r = spawnSync('bash', ['--version'], { encoding: 'utf8' });
  return r.status === 0;
}

function makeHarness(patterns: 'strict' | 'moderate' | 'minimal'): {
  harnessRoot: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-guard-'));
  writeFileSync(
    join(dir, 'harness.lock'),
    JSON.stringify({
      schema_version: 1,
      acorn_version: '0.1.3',
      tools: {
        omc: { repo: 'org/omc', commit: SHA, verified_at: '2026-04-17' },
        gstack: { repo: 'org/gstack', commit: SHA, verified_at: '2026-04-17' },
        ecc: { repo: 'org/ecc', commit: SHA, verified_at: '2026-04-17' },
      },
      guard: { mode: 'block', patterns },
    }),
    'utf8',
  );
  return {
    harnessRoot: dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function runHook(
  harnessRoot: string,
  command: string,
): { exitCode: number; stderr: string } {
  const payload = JSON.stringify({ tool_input: { command } });
  const res = spawnSync('bash', [packagedHookPath()], {
    input: payload,
    env: { ...process.env, ACORN_HARNESS_ROOT: harnessRoot },
    encoding: 'utf8',
  });
  return { exitCode: res.status ?? -1, stderr: res.stderr ?? '' };
}

// bash 없는 환경에서는 전부 skip
if (bashAvailable()) {
  test('guard strict: push --force 차단 (§15 H1 regression guard)', () => {
    const w = makeHarness('strict');
    try {
      const r = runHook(w.harnessRoot, 'git push --force origin main');
      assert.equal(r.exitCode, 1);
      assert.match(r.stderr, /차단.*patterns=strict/);
    } finally {
      w.cleanup();
    }
  });

  test('guard moderate: push --force 통과 (strict 와 다른 동작)', () => {
    const w = makeHarness('moderate');
    try {
      const r = runHook(w.harnessRoot, 'git push --force origin main');
      assert.equal(r.exitCode, 0, 'moderate 는 push --force 허용');
    } finally {
      w.cleanup();
    }
  });

  test('guard moderate: rm -rf 은 여전히 차단', () => {
    const w = makeHarness('moderate');
    try {
      const r = runHook(w.harnessRoot, 'rm -rf /tmp/foo');
      assert.equal(r.exitCode, 1);
      assert.match(r.stderr, /patterns=moderate/);
    } finally {
      w.cleanup();
    }
  });

  test('guard minimal: rm -rf 도 통과 (minimal 은 catastrophic 만)', () => {
    const w = makeHarness('minimal');
    try {
      const r = runHook(w.harnessRoot, 'rm -rf /tmp/foo');
      assert.equal(r.exitCode, 0, 'minimal 은 rm -rf 허용');
    } finally {
      w.cleanup();
    }
  });

  test('guard minimal: mkfs 는 여전히 차단 (catastrophic)', () => {
    const w = makeHarness('minimal');
    try {
      const r = runHook(w.harnessRoot, 'mkfs.ext4 /dev/sdb1');
      assert.equal(r.exitCode, 1);
      assert.match(r.stderr, /patterns=minimal/);
    } finally {
      w.cleanup();
    }
  });

  test('guard: ACORN_GUARD_PATTERNS env override', () => {
    const w = makeHarness('strict');
    try {
      // lock 은 strict 인데 env 로 minimal 오버라이드
      const payload = JSON.stringify({
        tool_input: { command: 'git push --force origin main' },
      });
      const r = spawnSync('bash', [packagedHookPath()], {
        input: payload,
        env: {
          ...process.env,
          ACORN_HARNESS_ROOT: w.harnessRoot,
          ACORN_GUARD_PATTERNS: 'minimal',
        },
        encoding: 'utf8',
      });
      assert.equal(r.status, 0, 'env override → minimal → push --force 통과');
    } finally {
      w.cleanup();
    }
  });

  test('guard: push --force-with-lease 는 모든 레벨에서 통과', () => {
    for (const patterns of ['strict', 'moderate', 'minimal'] as const) {
      const w = makeHarness(patterns);
      try {
        const r = runHook(w.harnessRoot, 'git push --force-with-lease origin main');
        assert.equal(r.exitCode, 0, `${patterns}: force-with-lease 허용되어야 함`);
      } finally {
        w.cleanup();
      }
    }
  });
}
