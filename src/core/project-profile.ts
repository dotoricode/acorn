export type TestMaturity = 'none' | 'low' | 'medium' | 'high';

export interface ProjectProfile {
  readonly hasUi: boolean;
  readonly hasBackend: boolean;
  readonly hasWorkers: boolean;
  readonly testMaturity: TestMaturity;
}

export interface ProjectSignals {
  readonly files: readonly string[];
  readonly dependencies?: readonly string[];
}

// ── heuristic keyword sets ────────────────────────────────────────────────────

const UI_DEPS = new Set([
  'react', 'react-dom', 'vue', '@vue/core', 'svelte', '@angular/core',
  'next', 'nuxt', 'solid-js', 'preact', 'lit', 'qwik', 'astro',
]);

const UI_FILE_EXTS = ['.jsx', '.tsx', '.svelte', '.vue', '.html'];

const BACKEND_DEPS = new Set([
  'express', 'fastify', 'koa', 'hono', 'restify', '@hapi/hapi',
  '@nestjs/core', 'nestjs', 'polka', 'micro',
]);

const BACKEND_DIRS = ['routes', 'controllers', 'api', 'server', 'handlers', 'middleware'];

const WORKER_DEPS = new Set([
  'bull', 'bullmq', 'bee-queue', 'amqplib', 'kafkajs',
  'pg-boss', 'agenda', 'node-cron', 'cron', 'p-queue',
]);

const WORKER_DIRS = ['workers', 'jobs', 'queues', 'webhooks', 'consumers', 'cron'];

const TEST_PATTERNS = ['.test.', '.spec.', '__tests__', '/tests/'];

// ── signal helpers ────────────────────────────────────────────────────────────

function hasDep(deps: readonly string[], set: Set<string>): boolean {
  return deps.some((d) => set.has(d));
}

function hasFileExt(files: readonly string[], exts: readonly string[]): boolean {
  return files.some((f) => exts.some((e) => f.endsWith(e)));
}

function hasDir(files: readonly string[], dirs: readonly string[]): boolean {
  return files.some((f) =>
    dirs.some((d) => f.startsWith(`${d}/`) || f.includes(`/${d}/`)),
  );
}

function inferTestMaturity(files: readonly string[]): TestMaturity {
  const testFiles = files.filter((f) => TEST_PATTERNS.some((p) => f.includes(p)));
  if (testFiles.length === 0) return 'none';
  if (testFiles.length < 5) return 'low';
  if (testFiles.length < 20) return 'medium';
  return 'high';
}

// ── public API ────────────────────────────────────────────────────────────────

export function inferProfile(signals: ProjectSignals): ProjectProfile {
  const { files, dependencies: deps = [] } = signals;

  return {
    hasUi: hasDep(deps, UI_DEPS) || hasFileExt(files, UI_FILE_EXTS),
    hasBackend: hasDep(deps, BACKEND_DEPS) || hasDir(files, BACKEND_DIRS),
    hasWorkers: hasDep(deps, WORKER_DEPS) || hasDir(files, WORKER_DIRS),
    testMaturity: inferTestMaturity(files),
  };
}
