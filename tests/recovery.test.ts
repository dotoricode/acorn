// v0.9.7+: drift 자동 복구 — classifyIssue + runRecovery + render.
process.env['ACORN_ALLOW_ANY_REPO'] = '1';

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  classifyIssue,
  runRecovery,
  renderRecoveryReport,
  RecoveryError,
} from '../src/core/recovery.ts';
import type { DoctorIssue } from '../src/commands/doctor.ts';

interface WS {
  dir: string;
  harnessRoot: string;
  cleanup: () => void;
}

function makeWS(): WS {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-recovery-'));
  const harnessRoot = join(dir, 'harness');
  mkdirSync(harnessRoot, { recursive: true });
  return {
    dir,
    harnessRoot,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function issue(partial: Partial<DoctorIssue> & Pick<DoctorIssue, 'area' | 'severity' | 'message'>): DoctorIssue {
  return {
    subject: 'subject',
    hint: 'manual hint',
    ...partial,
  };
}

// ── classifyIssue: tier 매핑 ────────────────────────────────────────────────

test('classifyIssue: vendor missing → safe + reinstall', () => {
  const s = classifyIssue(
    issue({ area: 'vendor', severity: 'critical', message: 'vendor 미설치: gstack' }),
  );
  assert.equal(s.tier, 'safe');
  assert.equal(s.action, 'reinstall');
});

test('classifyIssue: vendor SHA 불일치 → safe + reinstall', () => {
  const s = classifyIssue(
    issue({ area: 'vendor', severity: 'warning', message: 'gstack SHA 불일치 (lock=abc, 실제=def)' }),
  );
  assert.equal(s.tier, 'safe');
  assert.equal(s.action, 'reinstall');
});

test('classifyIssue: vendor 로컬 변경 → refuse', () => {
  const s = classifyIssue(
    issue({ area: 'vendor', severity: 'warning', message: 'vendor 에 로컬 변경이 있음 (paths: foo)' }),
  );
  assert.equal(s.tier, 'refuse');
  assert.equal(s.action, null);
  assert.match(s.reason, /dirty/);
});

test('classifyIssue: vendor rev-parse 실패 → refuse', () => {
  const s = classifyIssue(
    issue({ area: 'vendor', severity: 'critical', message: 'gstack rev-parse 실패: ENOENT' }),
  );
  assert.equal(s.tier, 'refuse');
});

test('classifyIssue: vendor npm 버전 drift (info) → refuse', () => {
  const s = classifyIssue(
    issue({
      area: 'vendor',
      severity: 'info',
      message: 'claudekit npm 버전 drift (lock: 1.0.0 → registry: 1.1.0)',
    }),
  );
  assert.equal(s.tier, 'refuse');
});

test('classifyIssue: symlink 부재 → safe + reinstall', () => {
  const s = classifyIssue(
    issue({ area: 'symlink', severity: 'critical', message: 'gstack 심링크 부재: /tmp/gstack' }),
  );
  assert.equal(s.tier, 'safe');
});

test('classifyIssue: symlink 가 일반 디렉토리 → refuse', () => {
  const s = classifyIssue(
    issue({
      area: 'symlink',
      severity: 'critical',
      message: '/tmp/gstack 이 심링크가 아닌 일반 경로 (사용자 데이터 의심)',
    }),
  );
  assert.equal(s.tier, 'refuse');
  assert.match(s.reason, /사용자 데이터/);
});

test('classifyIssue: env 미설정 → safe + reinstall', () => {
  const s = classifyIssue(
    issue({ area: 'env', severity: 'warning', message: 'CLAUDE_PLUGIN_ROOT 미설정' }),
  );
  assert.equal(s.tier, 'safe');
});

test('classifyIssue: env runtime mismatch (info) → refuse', () => {
  const s = classifyIssue(
    issue({
      area: 'env',
      severity: 'info',
      message:
        'CLAUDE_PLUGIN_ROOT 는 settings.json 기준 정확하나 Claude Code 세션 runtime 에 반영 안 됨',
    }),
  );
  assert.equal(s.tier, 'refuse');
});

test('classifyIssue: tx 미완료 → refuse', () => {
  const s = classifyIssue(
    issue({ area: 'tx', severity: 'critical', message: '이전 설치 미완료' }),
  );
  assert.equal(s.tier, 'refuse');
});

test('classifyIssue: ACORN_GUARD_BYPASS → refuse', () => {
  const s = classifyIssue(
    issue({
      area: 'guard',
      severity: 'critical',
      subject: 'ACORN_GUARD_BYPASS',
      message: 'ACORN_GUARD_BYPASS=1 이 현재 프로세스 env 에 설정됨',
    }),
  );
  assert.equal(s.tier, 'refuse');
  assert.match(s.reason, /unset/);
});

test('classifyIssue: phase.txt 누락 → refuse (사용자 결정)', () => {
  const s = classifyIssue(
    issue({ area: 'phase', severity: 'warning', subject: 'phase.txt', message: 'phase.txt 없음' }),
  );
  assert.equal(s.tier, 'refuse');
});

test('classifyIssue: CLAUDE.md 마커 손상 → refuse', () => {
  const s = classifyIssue(
    issue({
      area: 'phase',
      severity: 'critical',
      subject: 'CLAUDE.md',
      message: 'CLAUDE.md phase 마커 손상 (START/END 불균형)',
    }),
  );
  assert.equal(s.tier, 'refuse');
});

test('classifyIssue: CLAUDE.md 불일치 → safe + reinstall', () => {
  const s = classifyIssue(
    issue({
      area: 'phase',
      severity: 'warning',
      subject: 'CLAUDE.md',
      message: 'CLAUDE.md phase 마커가 phase.txt 와 불일치',
    }),
  );
  assert.equal(s.tier, 'safe');
});

test('classifyIssue: capability 미설치 → safe + reinstall', () => {
  const s = classifyIssue(
    issue({
      area: 'capability',
      severity: 'warning',
      message: 'review 활성화됨 — 모든 제공자 미설치',
    }),
  );
  assert.equal(s.tier, 'safe');
});

test('classifyIssue: capability 미설정 → refuse', () => {
  const s = classifyIssue(
    issue({
      area: 'capability',
      severity: 'warning',
      message: 'memory 활성화됨 — lock 에 제공자가 설정되지 않음',
    }),
  );
  assert.equal(s.tier, 'refuse');
});

test('classifyIssue: 미정의 케이스 → refuse default', () => {
  const s = classifyIssue(
    issue({ area: 'lock', severity: 'critical', message: '무엇인가 새로운 이슈' }),
  );
  assert.equal(s.tier, 'refuse');
  assert.match(s.reason, /자동 복구 전략 미정의/);
});

// ── runRecovery: 그룹 실행 + 결과 ────────────────────────────────────────

test('runRecovery: 빈 issues → fixed=0 remaining=0', () => {
  const w = makeWS();
  try {
    const r = runRecovery({ issues: [], harnessRoot: w.harnessRoot });
    assert.equal(r.fixed, 0);
    assert.equal(r.remaining, 0);
    assert.equal(r.outcomes.length, 0);
  } finally {
    w.cleanup();
  }
});

test('runRecovery: 모두 refuse → reinstall 콜백 호출 안 함', () => {
  const w = makeWS();
  try {
    let called = 0;
    const r = runRecovery({
      issues: [
        issue({ area: 'tx', severity: 'critical', message: '이전 설치 미완료' }),
        issue({ area: 'guard', severity: 'critical', subject: 'ACORN_GUARD_BYPASS', message: 'set' }),
      ],
      harnessRoot: w.harnessRoot,
      reinstall: () => {
        called++;
      },
    });
    assert.equal(called, 0);
    assert.equal(r.refused, 2);
    assert.equal(r.fixed, 0);
    assert.equal(r.remaining, 2);
  } finally {
    w.cleanup();
  }
});

test('runRecovery: safe 1 + refuse 1 → reinstall 1회 + safe 1 fixed', () => {
  const w = makeWS();
  try {
    let called = 0;
    const r = runRecovery({
      issues: [
        issue({ area: 'vendor', severity: 'critical', message: 'vendor 미설치: gstack', subject: 'gstack' }),
        issue({ area: 'tx', severity: 'critical', message: '이전 설치 미완료', subject: 'tx.log' }),
      ],
      harnessRoot: w.harnessRoot,
      reinstall: () => {
        called++;
      },
    });
    assert.equal(called, 1, 'reinstall 은 그룹 실행이라 1 회만');
    assert.equal(r.fixed, 1);
    assert.equal(r.refused, 1);
    assert.equal(r.remaining, 1);
  } finally {
    w.cleanup();
  }
});

test('runRecovery: safe N → reinstall 1회 + N fixed', () => {
  const w = makeWS();
  try {
    let called = 0;
    const r = runRecovery({
      issues: [
        issue({ area: 'vendor', severity: 'critical', message: 'vendor 미설치: gstack', subject: 'gstack' }),
        issue({ area: 'symlink', severity: 'critical', message: 'gstack 심링크 부재', subject: 'gstack' }),
        issue({ area: 'env', severity: 'warning', message: 'CLAUDE_PLUGIN_ROOT 미설정', subject: 'CLAUDE_PLUGIN_ROOT' }),
      ],
      harnessRoot: w.harnessRoot,
      reinstall: () => {
        called++;
      },
    });
    assert.equal(called, 1);
    assert.equal(r.fixed, 3);
    assert.equal(r.refused, 0);
    assert.equal(r.remaining, 0);
  } finally {
    w.cleanup();
  }
});

test('runRecovery: reinstall throw → 모든 safe 가 failed 로 마감', () => {
  const w = makeWS();
  try {
    const r = runRecovery({
      issues: [
        issue({ area: 'vendor', severity: 'critical', message: 'vendor 미설치: gstack', subject: 'gstack' }),
        issue({ area: 'symlink', severity: 'critical', message: 'gstack 심링크 부재', subject: 'gstack' }),
      ],
      harnessRoot: w.harnessRoot,
      reinstall: () => {
        throw new Error('네트워크 다운');
      },
    });
    assert.equal(r.fixed, 0);
    assert.equal(r.failed, 2);
    assert.equal(r.remaining, 2);
    assert.ok(r.outcomes.every((o) => o.detail?.includes('네트워크 다운')));
  } finally {
    w.cleanup();
  }
});

test('runRecovery: safe 있는데 reinstall 콜백 미주입 → NO_REINSTALL throw', () => {
  const w = makeWS();
  try {
    assert.throws(
      () =>
        runRecovery({
          issues: [
            issue({
              area: 'vendor',
              severity: 'critical',
              message: 'vendor 미설치: gstack',
              subject: 'gstack',
            }),
          ],
          harnessRoot: w.harnessRoot,
        }),
      (e: unknown) => e instanceof RecoveryError && e.code === 'NO_REINSTALL',
    );
  } finally {
    w.cleanup();
  }
});

test('runRecovery: safe 없으면 reinstall 콜백 미주입도 OK', () => {
  const w = makeWS();
  try {
    const r = runRecovery({
      issues: [
        issue({ area: 'tx', severity: 'critical', message: '이전 설치 미완료', subject: 'tx.log' }),
      ],
      harnessRoot: w.harnessRoot,
    });
    assert.equal(r.refused, 1);
    assert.equal(r.fixed, 0);
  } finally {
    w.cleanup();
  }
});

// ── recovery.jsonl forensic log ──────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';

test('runRecovery: install 성공 시 recovery.jsonl 에 classify+execute+success 라인', () => {
  const w = makeWS();
  try {
    runRecovery({
      issues: [
        issue({
          area: 'vendor',
          severity: 'critical',
          message: 'vendor 미설치: gstack',
          subject: 'gstack',
        }),
      ],
      harnessRoot: w.harnessRoot,
      reinstall: () => undefined,
    });
    const logPath = join(w.harnessRoot, 'recovery.jsonl');
    assert.ok(existsSync(logPath), 'recovery.jsonl 파일 누락');
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    const phases = lines.map((l) => JSON.parse(l).phase);
    assert.deepEqual(phases, ['recovery-classify', 'recovery-execute', 'recovery-success']);
  } finally {
    w.cleanup();
  }
});

test('runRecovery: install 실패 시 recovery.jsonl 에 recovery-failed 마커', () => {
  const w = makeWS();
  try {
    runRecovery({
      issues: [
        issue({
          area: 'vendor',
          severity: 'critical',
          message: 'vendor 미설치: gstack',
          subject: 'gstack',
        }),
      ],
      harnessRoot: w.harnessRoot,
      reinstall: () => {
        throw new Error('boom');
      },
    });
    const logPath = join(w.harnessRoot, 'recovery.jsonl');
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    const phases = lines.map((l) => JSON.parse(l).phase);
    assert.ok(phases.includes('recovery-failed'));
    const failedEntry = JSON.parse(lines[lines.length - 1]!);
    assert.equal(failedEntry.error, 'boom');
  } finally {
    w.cleanup();
  }
});

test('runRecovery: install 의 tx.log 와 분리 — recovery 가 IN_PROGRESS 만들지 않음', () => {
  const w = makeWS();
  try {
    runRecovery({
      issues: [
        issue({
          area: 'vendor',
          severity: 'critical',
          message: 'vendor 미설치: gstack',
          subject: 'gstack',
        }),
      ],
      harnessRoot: w.harnessRoot,
      reinstall: () => undefined,
    });
    // tx.log 가 비어있거나 존재하지 않아야 함 — recovery 가 거기 쓰지 말아야.
    const txLog = join(w.harnessRoot, 'tx.log');
    if (existsSync(txLog)) {
      const content = readFileSync(txLog, 'utf8');
      assert.equal(content, '', `tx.log 가 recovery 에 의해 오염됨: ${content}`);
    }
  } finally {
    w.cleanup();
  }
});

// ── render ───────────────────────────────────────────────────────────────────

test('renderRecoveryReport: 모든 결과 타입의 아이콘 출력', () => {
  const out = renderRecoveryReport({
    outcomes: [
      {
        issue: issue({
          area: 'vendor',
          severity: 'critical',
          message: 'vendor 미설치',
          subject: 'gstack',
        }),
        strategy: { tier: 'safe', action: 'reinstall', reason: 'idempotent' },
        result: 'fixed',
        detail: 'install ran',
      },
      {
        issue: issue({
          area: 'tx',
          severity: 'critical',
          message: '이전 설치 미완료',
          subject: 'tx.log',
        }),
        strategy: { tier: 'refuse', action: null, reason: '수동 검토 필요' },
        result: 'refused',
      },
    ],
    fixed: 1,
    skipped: 0,
    refused: 1,
    failed: 0,
    remaining: 1,
  });
  assert.ok(out.includes('fixed=1'));
  assert.ok(out.includes('refused=1'));
  assert.ok(out.includes('✅'));
  assert.ok(out.includes('🚫'));
  assert.ok(out.includes('자동 복구되지 않았습니다'));
});

test('renderRecoveryReport: 빈 outcomes → 안내 문구', () => {
  const out = renderRecoveryReport({
    outcomes: [],
    fixed: 0,
    skipped: 0,
    refused: 0,
    failed: 0,
    remaining: 0,
  });
  assert.ok(out.includes('아무 이슈도 없음'));
});
