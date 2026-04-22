import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  qaHeadlessGuidance,
  qaHeadlessNoProviderMessage,
  QA_HEADLESS_PROJECT_TYPES,
  type QaHeadlessProjectType,
} from '../src/core/qa-headless.ts';

// ── qaHeadlessGuidance: shape ─────────────────────────────────────────────────

test('qaHeadlessGuidance: returns object with projectType, checklist, hint', () => {
  const g = qaHeadlessGuidance('api');
  assert.equal(g.projectType, 'api');
  assert.ok(Array.isArray(g.checklist));
  assert.ok(g.checklist.length > 0);
  assert.ok(typeof g.hint === 'string');
  assert.ok(g.hint.length > 0);
});

// ── all project types have non-empty checklists ───────────────────────────────

for (const pt of QA_HEADLESS_PROJECT_TYPES) {
  test(`qaHeadlessGuidance: ${pt} has ≥1 checklist item and a non-empty hint`, () => {
    const g = qaHeadlessGuidance(pt as QaHeadlessProjectType);
    assert.equal(g.projectType, pt);
    assert.ok(g.checklist.length >= 1, `${pt} checklist must not be empty`);
    assert.ok(g.hint.trim().length > 0, `${pt} hint must not be empty`);
  });
}

// ── api guidance content spot-checks ─────────────────────────────────────────

test('qaHeadlessGuidance api: checklist mentions auth boundary', () => {
  const g = qaHeadlessGuidance('api');
  const combined = g.checklist.join(' ');
  assert.ok(
    combined.includes('401') || combined.includes('403') || combined.toLowerCase().includes('auth'),
    'api checklist should mention auth/401/403',
  );
});

test('qaHeadlessGuidance api: hint mentions curl or rest-client', () => {
  const g = qaHeadlessGuidance('api');
  assert.ok(
    g.hint.toLowerCase().includes('curl') || g.hint.toLowerCase().includes('rest'),
    'api hint should mention curl or rest-client',
  );
});

// ── worker guidance content spot-checks ──────────────────────────────────────

test('qaHeadlessGuidance worker: checklist mentions idempotency or queue', () => {
  const g = qaHeadlessGuidance('worker');
  const combined = g.checklist.join(' ').toLowerCase();
  assert.ok(
    combined.includes('멱등') || combined.includes('queue') || combined.includes('큐'),
    'worker checklist should mention idempotency or queue',
  );
});

// ── webhook guidance content spot-checks ─────────────────────────────────────

test('qaHeadlessGuidance webhook: checklist mentions signature validation', () => {
  const g = qaHeadlessGuidance('webhook');
  const combined = g.checklist.join(' ').toLowerCase();
  assert.ok(
    combined.includes('서명') || combined.includes('hmac') || combined.includes('토큰'),
    'webhook checklist should mention signature/HMAC',
  );
});

// ── cli guidance content spot-checks ─────────────────────────────────────────

test('qaHeadlessGuidance cli: checklist mentions exit code', () => {
  const g = qaHeadlessGuidance('cli');
  const combined = g.checklist.join(' ').toLowerCase();
  assert.ok(
    combined.includes('exit') || combined.includes('exit code'),
    'cli checklist should mention exit code',
  );
});

// ── cron guidance content spot-checks ────────────────────────────────────────

test('qaHeadlessGuidance cron: checklist mentions duplicate prevention', () => {
  const g = qaHeadlessGuidance('cron');
  const combined = g.checklist.join(' ').toLowerCase();
  assert.ok(
    combined.includes('중복') || combined.includes('locking') || combined.includes('idempotency'),
    'cron checklist should mention duplicate prevention',
  );
});

// ── qaHeadlessNoProviderMessage ───────────────────────────────────────────────

test('qaHeadlessNoProviderMessage: includes project type', () => {
  const msg = qaHeadlessNoProviderMessage('api');
  assert.ok(msg.includes('api'), 'message should include project type');
});

test('qaHeadlessNoProviderMessage: includes provider-absent notice', () => {
  const msg = qaHeadlessNoProviderMessage('worker');
  assert.ok(
    msg.includes('제공자') || msg.includes('provider') || msg.includes('없음'),
    'message should mention no provider',
  );
});

test('qaHeadlessNoProviderMessage: includes checklist items', () => {
  const msg = qaHeadlessNoProviderMessage('cron');
  const g = qaHeadlessGuidance('cron');
  for (const item of g.checklist) {
    assert.ok(msg.includes(item), `message should contain checklist item: ${item}`);
  }
});

test('qaHeadlessNoProviderMessage: includes hint text', () => {
  const msg = qaHeadlessNoProviderMessage('webhook');
  const g = qaHeadlessGuidance('webhook');
  assert.ok(msg.includes(g.hint), 'message should include the hint text');
});

// ── qa_headless first-class: no provider does not break the guidance ──────────

test('qa_headless is first-class: guidance available for all types without provider', () => {
  for (const pt of QA_HEADLESS_PROJECT_TYPES) {
    const msg = qaHeadlessNoProviderMessage(pt as QaHeadlessProjectType);
    assert.ok(msg.length > 0, `${pt}: message should not be empty`);
    assert.ok(msg.includes(pt), `${pt}: message should include project type`);
  }
});

// ── QA_HEADLESS_PROJECT_TYPES completeness ────────────────────────────────────

test('QA_HEADLESS_PROJECT_TYPES includes api, worker, cron, webhook, cli', () => {
  const expected: QaHeadlessProjectType[] = ['api', 'worker', 'cron', 'webhook', 'cli'];
  for (const pt of expected) {
    assert.ok(
      (QA_HEADLESS_PROJECT_TYPES as readonly string[]).includes(pt),
      `${pt} should be in QA_HEADLESS_PROJECT_TYPES`,
    );
  }
});
