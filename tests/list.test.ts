// §15 HIGH-2 / ADR-020 (v0.4.0): 가짜 repo 사용 — allowlist bypass.
process.env['ACORN_ALLOW_ANY_REPO'] = '1';

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectList,
  renderList,
  renderListJson,
  summarizeList,
} from '../src/commands/list.ts';
import type { GitRunner } from '../src/core/vendors.ts';

const SHA_OMC = 'a'.repeat(40);
const SHA_GSTACK = 'b'.repeat(40);
const SHA_ECC = 'c'.repeat(40);

function makeLockJson(): string {
  return JSON.stringify({
    schema_version: 1,
    acorn_version: '0.6.0',
    tools: {
      omc: { repo: 'org/omc', commit: SHA_OMC, verified_at: '2026-04-18' },
      gstack: { repo: 'org/gstack', commit: SHA_GSTACK, verified_at: '2026-04-18' },
      ecc: { repo: 'org/ecc', commit: SHA_ECC, verified_at: '2026-04-18' },
    },
    guard: { mode: 'block', patterns: 'strict' },
  });
}

interface WS {
  dir: string;
  lockPath: string;
  harnessRoot: string;
  vendorsRoot: string;
  cleanup: () => void;
}

function makeWS(): WS {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-list-'));
  const harnessRoot = join(dir, 'harness');
  const vendorsRoot = join(harnessRoot, 'vendors');
  const lockPath = join(harnessRoot, 'harness.lock');
  mkdirSync(harnessRoot, { recursive: true });
  writeFileSync(lockPath, makeLockJson(), 'utf8');
  return {
    dir,
    lockPath,
    harnessRoot,
    vendorsRoot,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function makeGitMock(heads: Record<string, string>): GitRunner {
  return {
    clone() { throw new Error('not expected'); },
    checkout() { throw new Error('not expected'); },
    revParse(dir) {
      const sha = heads[dir];
      if (!sha) throw new Error(`revParse: unknown dir ${dir}`);
      return sha;
    },
    isGitRepo(dir) { return heads[dir] !== undefined; },
    isDirty() { return false; },
  };
}

function setupAllVendors(w: WS, heads: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, sha] of Object.entries(heads)) {
    const p = join(w.vendorsRoot, name);
    mkdirSync(p, { recursive: true });
    out[p] = sha;
  }
  return out;
}

test('collectList: 모든 vendor 설치됨 + lock 일치 → locked', () => {
  const w = makeWS();
  try {
    const heads = setupAllVendors(w, {
      omc: SHA_OMC,
      gstack: SHA_GSTACK,
      ecc: SHA_ECC,
    });
    const r = collectList({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      git: makeGitMock(heads),
    });
    assert.equal(r.tools.length, 3);
    assert.ok(r.tools.every((t) => t.state === 'locked'));
    assert.equal(summarizeList(r).ok, true);
  } finally {
    w.cleanup();
  }
});

test('collectList: vendor 경로 부재 → missing', () => {
  const w = makeWS();
  try {
    // 아무 디렉토리도 만들지 않음
    const r = collectList({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      git: makeGitMock({}),
    });
    for (const t of r.tools) {
      assert.equal(t.state, 'missing');
      assert.equal(t.actualCommit, null);
    }
    const s = summarizeList(r);
    assert.equal(s.ok, false);
    assert.equal(s.issues.length, 3);
  } finally {
    w.cleanup();
  }
});

test('collectList: SHA 불일치 → drift', () => {
  const w = makeWS();
  try {
    const heads = setupAllVendors(w, {
      omc: 'd'.repeat(40), // 불일치
      gstack: SHA_GSTACK,
      ecc: SHA_ECC,
    });
    const r = collectList({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      git: makeGitMock(heads),
    });
    const omc = r.tools.find((t) => t.tool === 'omc');
    assert.ok(omc);
    assert.equal(omc.state, 'drift');
    assert.equal(omc.actualCommit, 'd'.repeat(40));
  } finally {
    w.cleanup();
  }
});

test('renderList: 표 형식 출력 (tool/sha/state/repo)', () => {
  const w = makeWS();
  try {
    const heads = setupAllVendors(w, {
      omc: SHA_OMC,
      gstack: SHA_GSTACK,
      ecc: SHA_ECC,
    });
    const r = collectList({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      git: makeGitMock(heads),
    });
    const out = renderList(r);
    assert.ok(out.includes('TOOL'));
    assert.ok(out.includes('omc'));
    assert.ok(out.includes('gstack'));
    assert.ok(out.includes('ecc'));
    assert.ok(out.includes('org/omc'));
  } finally {
    w.cleanup();
  }
});

test('renderListJson: 기계 판독용 JSON — jq 친화', () => {
  const w = makeWS();
  try {
    const heads = setupAllVendors(w, {
      omc: SHA_OMC,
      gstack: SHA_GSTACK,
      ecc: SHA_ECC,
    });
    const r = collectList({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      git: makeGitMock(heads),
    });
    const json = renderListJson(r);
    const parsed = JSON.parse(json);
    assert.equal(parsed.acornVersion, '0.6.0');
    assert.equal(parsed.tools.length, 3);
    assert.equal(parsed.tools[0].tool, 'omc');
  } finally {
    w.cleanup();
  }
});

test('summarizeList: 하나라도 비-locked → ok=false + issues 나열', () => {
  const w = makeWS();
  try {
    const heads = setupAllVendors(w, {
      omc: SHA_OMC,
      gstack: 'd'.repeat(40), // drift
      ecc: SHA_ECC,
    });
    const r = collectList({
      lockPath: w.lockPath,
      harnessRoot: w.harnessRoot,
      git: makeGitMock(heads),
    });
    const s = summarizeList(r);
    assert.equal(s.ok, false);
    assert.ok(s.issues.some((i) => i.startsWith('gstack:')));
  } finally {
    w.cleanup();
  }
});
