import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { recommend, renderRecommendation } from '../src/core/recommend.ts';
import { type ProjectProfile } from '../src/core/project-profile.ts';

// ── fixtures ──────────────────────────────────────────────────────────────────

const FRONTEND: ProjectProfile = {
  hasUi: true,
  hasBackend: false,
  hasWorkers: false,
  testMaturity: 'medium',
};

const BACKEND: ProjectProfile = {
  hasUi: false,
  hasBackend: true,
  hasWorkers: false,
  testMaturity: 'low',
};

const WORKER_ONLY: ProjectProfile = {
  hasUi: false,
  hasBackend: false,
  hasWorkers: true,
  testMaturity: 'medium',
};

const FULLSTACK: ProjectProfile = {
  hasUi: true,
  hasBackend: true,
  hasWorkers: true,
  testMaturity: 'none',
};

// ── frontend ──────────────────────────────────────────────────────────────────

test('frontend: qa_ui included', () => {
  const names = recommend(FRONTEND).capabilities.map((c) => c.capability);
  assert.ok(names.includes('qa_ui'));
});

test('frontend: qa_headless excluded', () => {
  const names = recommend(FRONTEND).capabilities.map((c) => c.capability);
  assert.ok(!names.includes('qa_headless'));
});

test('frontend: hooks is required', () => {
  const result = recommend(FRONTEND);
  const hooks = result.capabilities.find((c) => c.capability === 'hooks');
  assert.ok(hooks !== undefined);
  assert.equal(hooks.priority, 'required');
});

test('frontend: planning always present', () => {
  const names = recommend(FRONTEND).capabilities.map((c) => c.capability);
  assert.ok(names.includes('planning'));
});

test('frontend medium maturity: tdd is recommended, not required', () => {
  const tdd = recommend(FRONTEND).capabilities.find((c) => c.capability === 'tdd');
  assert.ok(tdd !== undefined);
  assert.equal(tdd.priority, 'recommended');
});

// ── backend ───────────────────────────────────────────────────────────────────

test('backend: spec included', () => {
  const names = recommend(BACKEND).capabilities.map((c) => c.capability);
  assert.ok(names.includes('spec'));
});

test('backend: qa_headless included', () => {
  const names = recommend(BACKEND).capabilities.map((c) => c.capability);
  assert.ok(names.includes('qa_headless'));
});

test('backend: qa_ui excluded', () => {
  const names = recommend(BACKEND).capabilities.map((c) => c.capability);
  assert.ok(!names.includes('qa_ui'));
});

test('backend low maturity: tdd required', () => {
  const tdd = recommend(BACKEND).capabilities.find((c) => c.capability === 'tdd');
  assert.ok(tdd !== undefined);
  assert.equal(tdd.priority, 'required');
});

test('backend: qa_headless has a reason string', () => {
  const qah = recommend(BACKEND).capabilities.find((c) => c.capability === 'qa_headless');
  assert.ok(qah !== undefined);
  assert.ok(qah.reason.length > 0);
});

// ── qa_headless special rule ──────────────────────────────────────────────────

test('qa_headless: recommended even if providers array is empty', () => {
  const qah = recommend(BACKEND).capabilities.find((c) => c.capability === 'qa_headless');
  assert.ok(qah !== undefined, 'qa_headless must appear in recommendations');
  // providers may be empty — that is acceptable per spec
  assert.ok(Array.isArray(qah.providers));
});

test('qa_headless: providers field is defined (not undefined)', () => {
  const qah = recommend(BACKEND).capabilities.find((c) => c.capability === 'qa_headless');
  assert.ok(qah !== undefined);
  assert.notEqual(qah.providers, undefined);
});

// ── workers ───────────────────────────────────────────────────────────────────

test('workers: spec and qa_headless included', () => {
  const names = recommend(WORKER_ONLY).capabilities.map((c) => c.capability);
  assert.ok(names.includes('spec'));
  assert.ok(names.includes('qa_headless'));
});

test('workers: qa_ui excluded', () => {
  const names = recommend(WORKER_ONLY).capabilities.map((c) => c.capability);
  assert.ok(!names.includes('qa_ui'));
});

// ── fullstack ─────────────────────────────────────────────────────────────────

test('fullstack + no tests: tdd required', () => {
  const tdd = recommend(FULLSTACK).capabilities.find((c) => c.capability === 'tdd');
  assert.ok(tdd !== undefined);
  assert.equal(tdd.priority, 'required');
});

test('fullstack: all key capabilities present', () => {
  const names = recommend(FULLSTACK).capabilities.map((c) => c.capability);
  for (const cap of ['planning', 'tdd', 'review', 'hooks', 'qa_ui', 'qa_headless', 'spec']) {
    assert.ok(names.includes(cap as never), `expected ${cap}`);
  }
});

test('fullstack: memory included (backend + UI)', () => {
  const names = recommend(FULLSTACK).capabilities.map((c) => c.capability);
  assert.ok(names.includes('memory'));
});

// ── provider presence ─────────────────────────────────────────────────────────

test('hooks providers include gstack', () => {
  const hooks = recommend(FRONTEND).capabilities.find((c) => c.capability === 'hooks');
  assert.ok(hooks !== undefined);
  assert.ok(hooks.providers.includes('gstack'));
});

test('planning providers include superpowers or gsd', () => {
  const planning = recommend(FRONTEND).capabilities.find((c) => c.capability === 'planning');
  assert.ok(planning !== undefined);
  assert.ok(
    planning.providers.includes('superpowers') || planning.providers.includes('gsd'),
    'planning should have at least one provider',
  );
});

// ── profile differentiation ───────────────────────────────────────────────────

test('frontend vs backend produce different capability sets', () => {
  const fe = recommend(FRONTEND).capabilities.map((c) => c.capability).sort().join(',');
  const be = recommend(BACKEND).capabilities.map((c) => c.capability).sort().join(',');
  assert.notEqual(fe, be);
});

test('tdd priority differs between low and high maturity', () => {
  const low = recommend({ ...FRONTEND, testMaturity: 'low' }).capabilities.find(
    (c) => c.capability === 'tdd',
  );
  const high = recommend({ ...FRONTEND, testMaturity: 'high' }).capabilities.find(
    (c) => c.capability === 'tdd',
  );
  assert.ok(low !== undefined && high !== undefined);
  assert.equal(low.priority, 'required');
  assert.equal(high.priority, 'recommended');
});

// ── rendering ─────────────────────────────────────────────────────────────────

test('renderRecommendation returns non-empty string', () => {
  const result = recommend(FRONTEND);
  const rendered = renderRecommendation(result);
  assert.ok(rendered.length > 0);
  assert.ok(rendered.includes('planning'));
  assert.ok(rendered.includes('hooks'));
});
