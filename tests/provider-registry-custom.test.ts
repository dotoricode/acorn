// v0.9.5+: 사용자 정의 Provider 레지스트리 (provider-loader + provider command).
// 테스트는 격리된 임시 harnessRoot 를 사용해 ACORN_HARNESS_ROOT 를 매번 재설정한다.
process.env['ACORN_ALLOW_ANY_REPO'] = '1';

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
  loadProviders,
  validateProviderDef,
  ProviderLoaderError,
  defaultProvidersDir,
  defaultAcornConfigPath,
  readProviderPolicy,
  writeProviderPolicy,
  type ProviderDef,
} from '../src/core/provider-loader.ts';
import {
  builtinProviders,
  clearProviderCache,
  listLoadedProviders,
  getProvider,
  getProviderSource,
  isCustomProvider,
} from '../src/core/providers.ts';
import {
  runProviderList,
  runProviderAdd,
  renderProviderAction,
} from '../src/commands/provider.ts';
import { runConfig } from '../src/commands/config.ts';

interface WS {
  dir: string;
  harnessRoot: string;
  cleanup: () => void;
}

function makeWS(): WS {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-provider-'));
  const harnessRoot = join(dir, 'harness');
  mkdirSync(harnessRoot, { recursive: true });
  return {
    dir,
    harnessRoot,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const VALID_DEF = {
  name: 'my-tool',
  displayName: 'My Tool',
  capabilities: [{ name: 'review', strength: 'primary' }],
  strategies: ['clone'],
  primaryStrategy: 'clone',
  repo: 'me/my-tool',
};

// ── schema validation ────────────────────────────────────────────────────────

test('validateProviderDef: 유효 정의 → 통과', () => {
  const def = validateProviderDef('test', VALID_DEF);
  assert.equal(def.name, 'my-tool');
  assert.equal(def.primaryStrategy, 'clone');
  assert.deepEqual(def.capabilities[0], { name: 'review', strength: 'primary' });
});

test('validateProviderDef: 빈 capabilities → SCHEMA', () => {
  assert.throws(
    () => validateProviderDef('test', { ...VALID_DEF, capabilities: [] }),
    (e: unknown) =>
      e instanceof ProviderLoaderError && e.code === 'SCHEMA' && /capabilities/.test(e.message),
  );
});

test('validateProviderDef: 잘못된 capability name → SCHEMA', () => {
  assert.throws(
    () =>
      validateProviderDef('test', {
        ...VALID_DEF,
        capabilities: [{ name: 'not-a-capability', strength: 'primary' }],
      }),
    (e: unknown) => e instanceof ProviderLoaderError && e.code === 'SCHEMA',
  );
});

test('validateProviderDef: primaryStrategy 가 strategies 밖 → SCHEMA', () => {
  assert.throws(
    () =>
      validateProviderDef('test', {
        ...VALID_DEF,
        strategies: ['clone'],
        primaryStrategy: 'npx',
      }),
    (e: unknown) =>
      e instanceof ProviderLoaderError && e.code === 'SCHEMA' && /primaryStrategy/.test(e.message),
  );
});

test('validateProviderDef: clone 인데 repo 없음 → SCHEMA', () => {
  const { repo, ...rest } = VALID_DEF;
  assert.throws(
    () => validateProviderDef('test', rest),
    (e: unknown) =>
      e instanceof ProviderLoaderError && e.code === 'SCHEMA' && /repo/.test(e.message),
  );
});

test('validateProviderDef: npx 인데 packageName 없음 → SCHEMA', () => {
  assert.throws(
    () =>
      validateProviderDef('test', {
        name: 'np-tool',
        displayName: 'NP',
        capabilities: [{ name: 'review', strength: 'partial' }],
        strategies: ['npx'],
        primaryStrategy: 'npx',
      }),
    (e: unknown) =>
      e instanceof ProviderLoaderError && e.code === 'SCHEMA' && /packageName/.test(e.message),
  );
});

test('validateProviderDef: 잘못된 name 형식 → SCHEMA', () => {
  assert.throws(
    () => validateProviderDef('test', { ...VALID_DEF, name: 'INVALID NAME' }),
    (e: unknown) =>
      e instanceof ProviderLoaderError && e.code === 'SCHEMA' && /name/.test(e.message),
  );
});

// ── disk loader ──────────────────────────────────────────────────────────────

test('loadProviders: 디스크 정의 추가 → user-file 로 등록', () => {
  const w = makeWS();
  try {
    const dir = defaultProvidersDir(w.harnessRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'my-tool.json'), JSON.stringify(VALID_DEF, null, 2), 'utf8');
    const result = loadProviders({
      harnessRoot: w.harnessRoot,
      env: {},
      builtins: builtinProviders(),
    });
    const names = result.providers.map((p) => p.def.name);
    assert.ok(names.includes('my-tool'), `name 누락: ${names.join(',')}`);
    const myTool = result.providers.find((p) => p.def.name === 'my-tool');
    assert.equal(myTool?.source, 'user-file');
    assert.ok(myTool?.path?.endsWith('my-tool.json'));
    assert.equal(result.warnings.length, 0);
  } finally {
    w.cleanup();
  }
});

test('loadProviders: 사용자 파일 vs builtin 충돌 → 사용자 우선 + warn', () => {
  const w = makeWS();
  try {
    const dir = defaultProvidersDir(w.harnessRoot);
    mkdirSync(dir, { recursive: true });
    const overridden = {
      ...VALID_DEF,
      name: 'gstack', // builtin 과 충돌
      displayName: 'My gstack',
      repo: 'me/forked-gstack',
    };
    writeFileSync(join(dir, 'gstack.json'), JSON.stringify(overridden, null, 2), 'utf8');
    const result = loadProviders({
      harnessRoot: w.harnessRoot,
      env: {},
      builtins: builtinProviders(),
    });
    const gstack = result.providers.find((p) => p.def.name === 'gstack');
    assert.equal(gstack?.source, 'user-file');
    assert.equal(gstack?.def.displayName, 'My gstack');
    assert.equal(gstack?.def.repo, 'me/forked-gstack');
    assert.ok(
      result.warnings.some((w) => /gstack/.test(w) && /덮어/.test(w)),
      `warn 누락: ${result.warnings.join('|')}`,
    );
  } finally {
    w.cleanup();
  }
});

test('loadProviders: ACORN_EXTRA_PROVIDERS env → 등록 + builtin 우선', () => {
  const w = makeWS();
  try {
    const extra = join(w.dir, 'extra.json');
    writeFileSync(
      extra,
      JSON.stringify({ ...VALID_DEF, name: 'extra-tool' }, null, 2),
      'utf8',
    );
    const result = loadProviders({
      harnessRoot: w.harnessRoot,
      env: { ACORN_EXTRA_PROVIDERS: extra },
      builtins: builtinProviders(),
    });
    const found = result.providers.find((p) => p.def.name === 'extra-tool');
    assert.equal(found?.source, 'env');
  } finally {
    w.cleanup();
  }
});

test('loadProviders: env 와 사용자 파일 충돌 → 사용자 파일 우선 + warn', () => {
  const w = makeWS();
  try {
    const extra = join(w.dir, 'env-side.json');
    writeFileSync(
      extra,
      JSON.stringify({ ...VALID_DEF, name: 'shared', displayName: 'env-side' }, null, 2),
      'utf8',
    );
    const dir = defaultProvidersDir(w.harnessRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'shared.json'),
      JSON.stringify({ ...VALID_DEF, name: 'shared', displayName: 'disk-side' }, null, 2),
      'utf8',
    );
    const result = loadProviders({
      harnessRoot: w.harnessRoot,
      env: { ACORN_EXTRA_PROVIDERS: extra },
      builtins: builtinProviders(),
    });
    const shared = result.providers.find((p) => p.def.name === 'shared');
    assert.equal(shared?.source, 'user-file');
    assert.equal(shared?.def.displayName, 'disk-side');
    assert.ok(result.warnings.length >= 1);
  } finally {
    w.cleanup();
  }
});

test('loadProviders: 손상된 JSON 파일 → PARSE 에러', () => {
  const w = makeWS();
  try {
    const dir = defaultProvidersDir(w.harnessRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'broken.json'), '{not json', 'utf8');
    assert.throws(
      () =>
        loadProviders({
          harnessRoot: w.harnessRoot,
          env: {},
          builtins: builtinProviders(),
        }),
      (e: unknown) => e instanceof ProviderLoaderError && e.code === 'PARSE',
    );
  } finally {
    w.cleanup();
  }
});

test('loadProviders: 파일명-name 불일치 → 등록 + warn', () => {
  const w = makeWS();
  try {
    const dir = defaultProvidersDir(w.harnessRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'wrong-name.json'),
      JSON.stringify(VALID_DEF, null, 2),
      'utf8',
    );
    const result = loadProviders({
      harnessRoot: w.harnessRoot,
      env: {},
      builtins: builtinProviders(),
    });
    const found = result.providers.find((p) => p.def.name === 'my-tool');
    assert.ok(found);
    assert.ok(
      result.warnings.some((w) => /파일명/.test(w)),
      `warn 누락: ${result.warnings.join('|')}`,
    );
  } finally {
    w.cleanup();
  }
});

// ── providers.ts cache + helpers ─────────────────────────────────────────────

test('providers cache: ACORN_HARNESS_ROOT 변경 후 clearProviderCache → 새 결과', () => {
  const w = makeWS();
  try {
    const original = process.env['ACORN_HARNESS_ROOT'];
    process.env['ACORN_HARNESS_ROOT'] = w.harnessRoot;
    try {
      clearProviderCache();
      // 추가 전: my-tool 없음
      assert.equal(getProvider('my-tool'), undefined);

      const dir = defaultProvidersDir(w.harnessRoot);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'my-tool.json'), JSON.stringify(VALID_DEF, null, 2), 'utf8');

      // 캐시 무효화 전: 여전히 없음
      assert.equal(getProvider('my-tool'), undefined);
      clearProviderCache();
      // 무효화 후: 보임
      const def = getProvider('my-tool');
      assert.ok(def);
      assert.equal(def.name, 'my-tool');
      assert.equal(getProviderSource('my-tool'), 'user-file');
      assert.equal(isCustomProvider('my-tool'), true);
      assert.equal(isCustomProvider('gstack'), false);
    } finally {
      if (original !== undefined) process.env['ACORN_HARNESS_ROOT'] = original;
      else delete process.env['ACORN_HARNESS_ROOT'];
      clearProviderCache();
    }
  } finally {
    w.cleanup();
  }
});

// ── runProviderList / runProviderAdd ─────────────────────────────────────────

test('runProviderList: 기본 → builtin 4개 + 빈 warning', () => {
  const w = makeWS();
  try {
    const original = process.env['ACORN_HARNESS_ROOT'];
    process.env['ACORN_HARNESS_ROOT'] = w.harnessRoot;
    try {
      clearProviderCache();
      const a = runProviderList();
      assert.equal(a.kind, 'list');
      if (a.kind === 'list') {
        assert.equal(a.providers.length, 4);
        assert.ok(a.providers.every((p) => p.source === 'builtin'));
        assert.equal(a.warnings.length, 0);
      }
    } finally {
      if (original !== undefined) process.env['ACORN_HARNESS_ROOT'] = original;
      else delete process.env['ACORN_HARNESS_ROOT'];
      clearProviderCache();
    }
  } finally {
    w.cleanup();
  }
});

test('runProviderAdd: 검증 통과 → providers/<name>.json 으로 복사', () => {
  const w = makeWS();
  try {
    const src = join(w.dir, 'src.json');
    writeFileSync(src, JSON.stringify(VALID_DEF, null, 2), 'utf8');
    const a = runProviderAdd(src, { harnessRoot: w.harnessRoot });
    assert.equal(a.kind, 'add');
    if (a.kind === 'add') {
      assert.equal(a.name, 'my-tool');
      assert.equal(a.overwritten, false);
      assert.ok(existsSync(a.to));
      const content = JSON.parse(readFileSync(a.to, 'utf8'));
      assert.equal(content.name, 'my-tool');
    }
  } finally {
    w.cleanup();
  }
});

test('runProviderAdd: 같은 name 이미 있고 --force 없음 → IO 에러', () => {
  const w = makeWS();
  try {
    const dir = defaultProvidersDir(w.harnessRoot);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'my-tool.json'), JSON.stringify(VALID_DEF, null, 2), 'utf8');

    const src = join(w.dir, 'src.json');
    writeFileSync(src, JSON.stringify(VALID_DEF, null, 2), 'utf8');
    assert.throws(
      () => runProviderAdd(src, { harnessRoot: w.harnessRoot }),
      (e: unknown) =>
        e instanceof ProviderLoaderError && e.code === 'IO' && /이미 존재/.test(e.message),
    );
  } finally {
    w.cleanup();
  }
});

test('runProviderAdd: --force → 덮어쓰기 + overwritten=true', () => {
  const w = makeWS();
  try {
    const dir = defaultProvidersDir(w.harnessRoot);
    mkdirSync(dir, { recursive: true });
    const oldDef = { ...VALID_DEF, displayName: 'OLD' };
    writeFileSync(join(dir, 'my-tool.json'), JSON.stringify(oldDef, null, 2), 'utf8');

    const src = join(w.dir, 'src.json');
    const newDef = { ...VALID_DEF, displayName: 'NEW' };
    writeFileSync(src, JSON.stringify(newDef, null, 2), 'utf8');
    const a = runProviderAdd(src, { harnessRoot: w.harnessRoot, force: true });
    assert.equal(a.kind, 'add');
    if (a.kind === 'add') {
      assert.equal(a.overwritten, true);
      const written = JSON.parse(readFileSync(a.to, 'utf8'));
      assert.equal(written.displayName, 'NEW');
    }
  } finally {
    w.cleanup();
  }
});

test('runProviderAdd: 잘못된 정의 → 디스크 미변경 + SCHEMA 에러', () => {
  const w = makeWS();
  try {
    const src = join(w.dir, 'bad.json');
    writeFileSync(src, JSON.stringify({ name: 'bad' }, null, 2), 'utf8');
    assert.throws(
      () => runProviderAdd(src, { harnessRoot: w.harnessRoot }),
      (e: unknown) => e instanceof ProviderLoaderError && e.code === 'SCHEMA',
    );
    // providers 디렉토리가 만들어졌더라도 bad.json 은 복사되지 않음.
    const dir = defaultProvidersDir(w.harnessRoot);
    if (existsSync(dir)) {
      assert.ok(!existsSync(join(dir, 'bad.json')));
    }
  } finally {
    w.cleanup();
  }
});

// ── provider policy ──────────────────────────────────────────────────────────

test('readProviderPolicy: 파일 없음 → 기본 false', () => {
  const w = makeWS();
  try {
    const policy = readProviderPolicy(w.harnessRoot);
    assert.equal(policy.allowCustomProviders, false);
  } finally {
    w.cleanup();
  }
});

test('writeProviderPolicy + readProviderPolicy: 라운드트립', () => {
  const w = makeWS();
  try {
    writeProviderPolicy({ allowCustomProviders: true }, w.harnessRoot);
    const policy = readProviderPolicy(w.harnessRoot);
    assert.equal(policy.allowCustomProviders, true);
    assert.ok(existsSync(defaultAcornConfigPath(w.harnessRoot)));
  } finally {
    w.cleanup();
  }
});

test('writeProviderPolicy: 기존 키 보존 (read-modify-write)', () => {
  const w = makeWS();
  try {
    const path = defaultAcornConfigPath(w.harnessRoot);
    mkdirSync(w.harnessRoot, { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ unrelated: 'keep me', provider: { allow_custom: false } }, null, 2),
      'utf8',
    );
    writeProviderPolicy({ allowCustomProviders: true }, w.harnessRoot);
    const after = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(after.unrelated, 'keep me');
    assert.equal(after.provider.allow_custom, true);
  } finally {
    w.cleanup();
  }
});

// ── config provider.allow-custom integration ────────────────────────────────

test('runConfig: provider.allow-custom get → 기본 false', () => {
  const w = makeWS();
  try {
    // get 경로는 lock 을 읽지 않으므로 lock 파일 없어도 OK.
    const a = runConfig('provider.allow-custom', undefined, {
      harnessRoot: w.harnessRoot,
      lockPath: '/nonexistent', // get 경로에서 사용 안 됨
    });
    assert.equal(a.kind, 'get');
    if (a.kind === 'get') {
      assert.equal(a.value, 'false');
    }
  } finally {
    w.cleanup();
  }
});

test('runConfig: provider.allow-custom set true → 라운드트립', () => {
  const w = makeWS();
  try {
    // set 경로는 tx.log 를 쓰므로 harnessRoot 가 존재해야 함 — makeWS 가 이미 mkdir.
    // lock 은 기본값을 만들어 주자 (set 경로가 lock 을 직접 보진 않지만 tx.log 가 lockPath
    // 을 안 보므로 OK).
    const a = runConfig('provider.allow-custom', 'true', {
      harnessRoot: w.harnessRoot,
      lockPath: join(w.harnessRoot, 'harness.lock'),
      yes: true,
    });
    assert.equal(a.kind, 'set');
    if (a.kind === 'set') {
      assert.equal(a.from, 'false');
      assert.equal(a.to, 'true');
    }
    const policy = readProviderPolicy(w.harnessRoot);
    assert.equal(policy.allowCustomProviders, true);
  } finally {
    w.cleanup();
  }
});

test('runConfig: provider.allow-custom 잘못된 값 → SCHEMA', () => {
  const w = makeWS();
  try {
    assert.throws(
      () =>
        runConfig('provider.allow-custom', 'maybe', {
          harnessRoot: w.harnessRoot,
          yes: true,
        }),
      (e: unknown) =>
        // ConfigError 는 AcornError 상속 — code 만 SCHEMA 검증.
        typeof e === 'object' &&
        e !== null &&
        'code' in e &&
        (e as { code: unknown }).code === 'SCHEMA',
    );
  } finally {
    w.cleanup();
  }
});

test('runConfig: provider.allow-custom noop (현재값과 동일)', () => {
  const w = makeWS();
  try {
    const a = runConfig('provider.allow-custom', 'false', {
      harnessRoot: w.harnessRoot,
      yes: true,
    });
    assert.equal(a.kind, 'noop');
  } finally {
    w.cleanup();
  }
});

// ── executeV3Providers gate ──────────────────────────────────────────────────

import { executeV3Providers, ProviderExecuteError, type NpxRunner } from '../src/core/provider-execute.ts';
import type { GitRunner } from '../src/core/vendors.ts';
import type { HarnessLockV3 } from '../src/core/lock.ts';

function noopGit(): GitRunner {
  return {
    clone() {
      throw new Error('clone not expected');
    },
    checkout() {
      throw new Error('checkout not expected');
    },
    revParse() {
      return 'a'.repeat(40);
    },
    isGitRepo() {
      return true;
    },
    isDirty() {
      return false;
    },
  };
}

function recordingNpx(): NpxRunner & { ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    run(cmd) {
      ran.push(cmd);
    },
  };
}

function makeCustomProviderLock(): HarnessLockV3 {
  return {
    schema_version: 3,
    acorn_version: '0.9.5',
    capabilities: {
      review: { providers: ['my-tool'] },
    },
    providers: {
      'my-tool': {
        install_strategy: 'npx',
        install_cmd: 'npx my-malicious-tool@latest',
        verified_at: '2026-04-30',
      },
    },
    guard: { mode: 'block', patterns: 'strict' },
  };
}

test('executeV3Providers: 사용자 정의 provider + allow-custom=false → CUSTOM_BLOCKED', () => {
  const w = makeWS();
  try {
    const dir = defaultProvidersDir(w.harnessRoot);
    mkdirSync(dir, { recursive: true });
    // my-tool 을 user-file 출처로 등록 (npx + packageName 필요)
    const def = {
      name: 'my-tool',
      displayName: 'My Tool',
      capabilities: [{ name: 'review', strength: 'primary' }],
      strategies: ['npx'],
      primaryStrategy: 'npx',
      packageName: 'my-malicious-tool',
    };
    writeFileSync(join(dir, 'my-tool.json'), JSON.stringify(def, null, 2), 'utf8');

    const original = process.env['ACORN_HARNESS_ROOT'];
    process.env['ACORN_HARNESS_ROOT'] = w.harnessRoot;
    try {
      clearProviderCache();
      const npx = recordingNpx();
      const lock = makeCustomProviderLock();
      assert.throws(
        () =>
          executeV3Providers(lock, {
            harnessRoot: w.harnessRoot,
            git: noopGit(),
            npxRunner: npx,
            log: () => undefined,
          }),
        (e: unknown) =>
          e instanceof ProviderExecuteError && e.code === 'CUSTOM_BLOCKED' &&
          /my-tool/.test(e.message),
      );
      // 차단 시 install_cmd 실행 안 됨.
      assert.equal(npx.ran.length, 0);
    } finally {
      if (original !== undefined) process.env['ACORN_HARNESS_ROOT'] = original;
      else delete process.env['ACORN_HARNESS_ROOT'];
      clearProviderCache();
    }
  } finally {
    w.cleanup();
  }
});

test('executeV3Providers: 사용자 정의 provider + allow-custom=true → 실행 허용', () => {
  const w = makeWS();
  try {
    const dir = defaultProvidersDir(w.harnessRoot);
    mkdirSync(dir, { recursive: true });
    const def = {
      name: 'my-tool',
      displayName: 'My Tool',
      capabilities: [{ name: 'review', strength: 'primary' }],
      strategies: ['npx'],
      primaryStrategy: 'npx',
      packageName: 'my-malicious-tool',
    };
    writeFileSync(join(dir, 'my-tool.json'), JSON.stringify(def, null, 2), 'utf8');
    writeProviderPolicy({ allowCustomProviders: true }, w.harnessRoot);

    const original = process.env['ACORN_HARNESS_ROOT'];
    process.env['ACORN_HARNESS_ROOT'] = w.harnessRoot;
    try {
      clearProviderCache();
      const npx = recordingNpx();
      const lock = makeCustomProviderLock();
      const results = executeV3Providers(lock, {
        harnessRoot: w.harnessRoot,
        git: noopGit(),
        npxRunner: npx,
        log: () => undefined,
      });
      assert.equal(results.length, 1);
      assert.equal(results[0]?.action, 'npx-ran');
      assert.deepEqual(npx.ran, ['npx my-malicious-tool@latest']);
    } finally {
      if (original !== undefined) process.env['ACORN_HARNESS_ROOT'] = original;
      else delete process.env['ACORN_HARNESS_ROOT'];
      clearProviderCache();
    }
  } finally {
    w.cleanup();
  }
});

test('executeV3Providers: builtin provider 는 정책과 무관하게 실행', () => {
  const w = makeWS();
  try {
    // claudekit 는 builtin → policy off 여도 실행되어야 함.
    const original = process.env['ACORN_HARNESS_ROOT'];
    process.env['ACORN_HARNESS_ROOT'] = w.harnessRoot;
    try {
      clearProviderCache();
      const npx = recordingNpx();
      const lock: HarnessLockV3 = {
        schema_version: 3,
        acorn_version: '0.9.5',
        capabilities: { hooks: { providers: ['claudekit'] } },
        providers: {
          claudekit: {
            install_strategy: 'npx',
            install_cmd: 'npx claudekit@latest',
            verified_at: '2026-04-30',
          },
        },
        guard: { mode: 'block', patterns: 'strict' },
      };
      const results = executeV3Providers(lock, {
        harnessRoot: w.harnessRoot,
        git: noopGit(),
        npxRunner: npx,
        log: () => undefined,
      });
      assert.equal(results.length, 1);
      assert.equal(results[0]?.action, 'npx-ran');
    } finally {
      if (original !== undefined) process.env['ACORN_HARNESS_ROOT'] = original;
      else delete process.env['ACORN_HARNESS_ROOT'];
      clearProviderCache();
    }
  } finally {
    w.cleanup();
  }
});

// ── render smoke ─────────────────────────────────────────────────────────────

test('renderProviderAction(list): builtin 출력', () => {
  const w = makeWS();
  try {
    const original = process.env['ACORN_HARNESS_ROOT'];
    process.env['ACORN_HARNESS_ROOT'] = w.harnessRoot;
    try {
      clearProviderCache();
      const a = runProviderList();
      const out = renderProviderAction(a);
      assert.ok(out.includes('Providers:'));
      assert.ok(out.includes('gstack'));
      assert.ok(out.includes('builtin'));
    } finally {
      if (original !== undefined) process.env['ACORN_HARNESS_ROOT'] = original;
      else delete process.env['ACORN_HARNESS_ROOT'];
      clearProviderCache();
    }
  } finally {
    w.cleanup();
  }
});
