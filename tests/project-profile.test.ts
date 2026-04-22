import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { inferProfile } from '../src/core/project-profile.ts';

// ── hasUi ────────────────────────────────────────────────────────────────────

test('react dep → hasUi=true', () => {
  const p = inferProfile({ files: ['src/App.tsx'], dependencies: ['react', 'react-dom'] });
  assert.equal(p.hasUi, true);
});

test('.tsx extension alone → hasUi=true', () => {
  const p = inferProfile({ files: ['src/App.tsx', 'src/main.ts'] });
  assert.equal(p.hasUi, true);
});

test('.svelte extension → hasUi=true', () => {
  const p = inferProfile({ files: ['src/App.svelte'] });
  assert.equal(p.hasUi, true);
});

test('.vue extension → hasUi=true', () => {
  const p = inferProfile({ files: ['src/App.vue'] });
  assert.equal(p.hasUi, true);
});

test('next dep → hasUi=true', () => {
  const p = inferProfile({ files: ['pages/index.ts'], dependencies: ['next'] });
  assert.equal(p.hasUi, true);
});

test('pure ts files, no UI dep → hasUi=false', () => {
  const p = inferProfile({ files: ['src/index.ts', 'src/utils.ts'], dependencies: ['axios'] });
  assert.equal(p.hasUi, false);
});

// ── hasBackend ────────────────────────────────────────────────────────────────

test('express dep → hasBackend=true', () => {
  const p = inferProfile({ files: ['server.ts'], dependencies: ['express'] });
  assert.equal(p.hasBackend, true);
  assert.equal(p.hasUi, false);
});

test('routes/ dir → hasBackend=true', () => {
  const p = inferProfile({ files: ['routes/users.ts', 'routes/auth.ts'] });
  assert.equal(p.hasBackend, true);
});

test('controllers/ dir → hasBackend=true', () => {
  const p = inferProfile({ files: ['controllers/users.ts'] });
  assert.equal(p.hasBackend, true);
});

test('fastify dep → hasBackend=true', () => {
  const p = inferProfile({ files: ['src/server.ts'], dependencies: ['fastify'] });
  assert.equal(p.hasBackend, true);
});

// ── hasWorkers ────────────────────────────────────────────────────────────────

test('bullmq dep → hasWorkers=true', () => {
  const p = inferProfile({ files: ['src/queue.ts'], dependencies: ['bullmq'] });
  assert.equal(p.hasWorkers, true);
});

test('workers/ dir → hasWorkers=true', () => {
  const p = inferProfile({ files: ['workers/email.ts', 'workers/cleanup.ts'] });
  assert.equal(p.hasWorkers, true);
});

test('jobs/ dir → hasWorkers=true', () => {
  const p = inferProfile({ files: ['jobs/daily-report.ts'] });
  assert.equal(p.hasWorkers, true);
});

test('webhooks/ dir → hasWorkers=true', () => {
  const p = inferProfile({ files: ['webhooks/stripe.ts'] });
  assert.equal(p.hasWorkers, true);
});

// ── testMaturity ──────────────────────────────────────────────────────────────

test('no test files → testMaturity=none', () => {
  const p = inferProfile({ files: ['src/index.ts', 'src/utils.ts'] });
  assert.equal(p.testMaturity, 'none');
});

test('2 test files, no coverage → testMaturity=low', () => {
  const p = inferProfile({
    files: ['src/index.ts', 'tests/index.test.ts', 'tests/utils.test.ts'],
  });
  assert.equal(p.testMaturity, 'low');
});

test('6 test files → testMaturity=medium', () => {
  const files = ['src/a.ts', ...Array.from({ length: 6 }, (_, i) => `tests/t${i}.test.ts`)];
  const p = inferProfile({ files });
  assert.equal(p.testMaturity, 'medium');
});

test('21 test files → testMaturity=high', () => {
  const files = ['src/a.ts', ...Array.from({ length: 21 }, (_, i) => `tests/t${i}.test.ts`)];
  const p = inferProfile({ files });
  assert.equal(p.testMaturity, 'high');
});

test('4 test files + c8 dep → testMaturity=low (coverage dep alone insufficient)', () => {
  const p = inferProfile({
    files: ['src/a.ts', ...Array.from({ length: 4 }, (_, i) => `tests/t${i}.test.ts`)],
    dependencies: ['c8'],
  });
  // 4 < 5 so still low even with coverage dep
  assert.equal(p.testMaturity, 'low');
});

// ── empty / combined ──────────────────────────────────────────────────────────

test('empty signals → all false, none', () => {
  const p = inferProfile({ files: [] });
  assert.equal(p.hasUi, false);
  assert.equal(p.hasBackend, false);
  assert.equal(p.hasWorkers, false);
  assert.equal(p.testMaturity, 'none');
});

test('fullstack: react + express + bullmq → all three true', () => {
  const p = inferProfile({
    files: ['src/App.tsx', 'routes/api.ts'],
    dependencies: ['react', 'express', 'bullmq'],
  });
  assert.equal(p.hasUi, true);
  assert.equal(p.hasBackend, true);
  assert.equal(p.hasWorkers, true);
});
