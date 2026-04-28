import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  AcornError,
  isAcornError,
  formatAcornError,
  docsUrl,
} from '../src/core/errors.ts';
import { LockError } from '../src/core/lock.ts';
import { InstallError } from '../src/commands/install.ts';
import { ConfigError } from '../src/commands/config.ts';
import { PresetError } from '../src/commands/preset.ts';
import { PhaseError } from '../src/commands/phase.ts';
import { UninstallError } from '../src/commands/uninstall.ts';
import { VendorError } from '../src/core/vendors.ts';
import { SettingsError } from '../src/core/settings.ts';
import { SymlinkError } from '../src/core/symlink.ts';
import { HooksError } from '../src/core/hooks.ts';
import { ClaudeMdError } from '../src/core/claude-md.ts';

// ── 베이스 클래스 ────────────────────────────────────────────────────────────

test('AcornError: namespace + code 필드 보존', () => {
  const e = new AcornError('boom', { namespace: 'install', code: 'FOO' });
  assert.equal(e.namespace, 'install');
  assert.equal(e.code, 'FOO');
  assert.equal(e.message, 'boom');
  assert.equal(e.hint, undefined);
  assert.equal(e.docsUrl, undefined);
});

test('AcornError: hint / docsUrl 옵션 전달', () => {
  const e = new AcornError('msg', {
    namespace: 'lock',
    code: 'PARSE',
    hint: 'JSON 문법 확인',
    docsUrl: 'https://example.com/docs',
  });
  assert.equal(e.hint, 'JSON 문법 확인');
  assert.equal(e.docsUrl, 'https://example.com/docs');
});

test('AcornError: cause 는 ES2022 native Error.cause 로 전파', () => {
  const root = new Error('root cause');
  const e = new AcornError('wrap', { namespace: 'install', code: 'IO', cause: root });
  assert.equal(e.cause, root);
});

test('isAcornError: AcornError 와 서브클래스 모두 true', () => {
  assert.equal(isAcornError(new AcornError('m', { namespace: 'x', code: 'Y' })), true);
  assert.equal(isAcornError(new LockError('m', 'PARSE')), true);
  assert.equal(isAcornError(new InstallError('m', 'IN_PROGRESS')), true);
  assert.equal(isAcornError(new Error('plain')), false);
  assert.equal(isAcornError('string'), false);
  assert.equal(isAcornError(null), false);
});

// ── formatAcornError ─────────────────────────────────────────────────────────

test('formatAcornError: 헤더만 (hint/docsUrl 없음)', () => {
  const e = new AcornError('parsing failed', { namespace: 'lock', code: 'PARSE' });
  assert.equal(formatAcornError(e), '[lock/PARSE] parsing failed');
});

test('formatAcornError: hint 라인 추가', () => {
  const e = new AcornError('failed', {
    namespace: 'install',
    code: 'IN_PROGRESS',
    hint: '--force 로 재실행',
  });
  const out = formatAcornError(e);
  assert.equal(
    out,
    '[install/IN_PROGRESS] failed\n   Hint: --force 로 재실행',
  );
});

test('formatAcornError: docsUrl 라인 추가', () => {
  const e = new AcornError('failed', {
    namespace: 'install',
    code: 'IN_PROGRESS',
    docsUrl: 'https://github.com/dotoricode/acorn',
  });
  const out = formatAcornError(e);
  assert.match(out, /\n   See:  https:\/\/github\.com\/dotoricode\/acorn$/);
});

test('formatAcornError: hint + docsUrl 둘 다', () => {
  const e = new AcornError('msg', {
    namespace: 'config',
    code: 'CONFIRM_REQUIRED',
    hint: 'h',
    docsUrl: 'https://x',
  });
  const out = formatAcornError(e);
  assert.equal(
    out,
    '[config/CONFIRM_REQUIRED] msg\n   Hint: h\n   See:  https://x',
  );
});

test('formatAcornError: 빈 문자열 hint 는 라인 생략 (length 0 가드)', () => {
  // 직접 init 으로 빈 문자열을 넣어도 출력에 포함되지 않아야 함.
  const e = new AcornError('msg', {
    namespace: 'x',
    code: 'Y',
    hint: '',
    docsUrl: '',
  });
  assert.equal(formatAcornError(e), '[x/Y] msg');
});

// ── docsUrl 헬퍼 ─────────────────────────────────────────────────────────────

test('docsUrl: 절대 URL 은 그대로 반환', () => {
  assert.equal(docsUrl('https://example.com'), 'https://example.com');
  assert.equal(docsUrl('http://example.com/x'), 'http://example.com/x');
});

test('docsUrl: # 시작 → README anchor', () => {
  assert.equal(
    docsUrl('#errors-install-IN_PROGRESS'),
    'https://github.com/dotoricode/acorn#errors-install-IN_PROGRESS',
  );
});

test('docsUrl: 상대 경로 → blob/main 정규화', () => {
  assert.equal(
    docsUrl('docs/USAGE.md'),
    'https://github.com/dotoricode/acorn/blob/main/docs/USAGE.md',
  );
  assert.equal(
    docsUrl('/docs/USAGE.md#install'),
    'https://github.com/dotoricode/acorn/blob/main/docs/USAGE.md#install',
  );
});

// ── 서브클래스 호환성 ────────────────────────────────────────────────────────
// 모든 11 개 서브클래스가 AcornError 를 상속하면서도 기존 instanceof + e.code
// 단언이 그대로 통과해야 한다.

test('LockError: AcornError + 자기 클래스 둘 다 instanceof 통과', () => {
  const e = new LockError('msg', 'SCHEMA');
  assert.ok(e instanceof LockError);
  assert.ok(e instanceof AcornError);
  assert.ok(e instanceof Error);
  assert.equal(e.code, 'SCHEMA');
  assert.equal(e.namespace, 'lock');
  assert.equal(e.name, 'LockError');
});

test('InstallError: cause + hint positional 시그니처 보존', () => {
  const root = new Error('inner');
  const e = new InstallError('wrap', 'VENDOR', root, '재시도');
  assert.ok(e instanceof InstallError);
  assert.ok(e instanceof AcornError);
  assert.equal(e.code, 'VENDOR');
  assert.equal(e.cause, root);
  assert.equal(e.hint, '재시도');
  assert.equal(e.namespace, 'install');
});

test('VendorError: tool 필드 보존', () => {
  const e = new VendorError('clone failed', 'CLONE', 'gstack');
  assert.ok(e instanceof VendorError);
  assert.ok(e instanceof AcornError);
  assert.equal(e.tool, 'gstack');
  assert.equal(e.code, 'CLONE');
  assert.equal(e.namespace, 'vendor');
});

test('SettingsError: conflicts 필드 보존', () => {
  const conflicts = [
    { key: 'CLAUDE_PLUGIN_ROOT' as const, current: 'a', desired: 'b' },
  ];
  const e = new SettingsError('conflict', 'CONFLICT', conflicts);
  assert.ok(e instanceof SettingsError);
  assert.ok(e instanceof AcornError);
  assert.deepEqual(e.conflicts, conflicts);
  assert.equal(e.namespace, 'settings');
});

test('SymlinkError: target 필드 보존', () => {
  const e = new SymlinkError('not symlink', 'NOT_SYMLINK', '/abs/path');
  assert.ok(e instanceof SymlinkError);
  assert.ok(e instanceof AcornError);
  assert.equal(e.target, '/abs/path');
  assert.equal(e.namespace, 'symlink');
});

test('11 개 서브클래스: namespace 확인', () => {
  const cases: Array<[AcornError, string]> = [
    [new InstallError('m', 'IN_PROGRESS'), 'install'],
    [new UninstallError('m', 'IO'), 'uninstall'],
    [new LockError('m', 'PARSE'), 'lock'],
    [new ConfigError('m', 'IO'), 'config'],
    [new PresetError('m', 'IO'), 'preset'],
    [new PhaseError('m', 'IO'), 'phase'],
    [new VendorError('m', 'CLONE', 'gstack'), 'vendor'],
    [new SettingsError('m', 'IO'), 'settings'],
    [new SymlinkError('m', 'IO', '/p'), 'symlink'],
    [new HooksError('m', 'IO'), 'hooks'],
    [new ClaudeMdError('m', 'IO'), 'claude-md'],
  ];
  for (const [err, expected] of cases) {
    assert.equal(err.namespace, expected, `${err.name} 의 namespace`);
    assert.ok(err instanceof AcornError, `${err.name} 은 AcornError 의 인스턴스여야 함`);
  }
});

test('formatAcornError: LockError 통해 호출 → [lock/CODE] 형식', () => {
  const e = new LockError('루트가 object 가 아닙니다', 'SCHEMA');
  assert.equal(formatAcornError(e), '[lock/SCHEMA] 루트가 object 가 아닙니다');
});

test('formatAcornError: PhaseError 의 hint 가 출력에 포함', () => {
  const e = new PhaseError(
    '알 수 없는 phase: "foo"',
    'INVALID_VALUE',
    'acorn phase prototype|dev|production',
  );
  const out = formatAcornError(e);
  assert.match(out, /^\[phase\/INVALID_VALUE\]/);
  assert.match(out, /\n   Hint: acorn phase /);
});
