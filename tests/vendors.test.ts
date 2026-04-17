import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  chmodSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  installVendor,
  toRepoUrl,
  VendorError,
  unexpectedDirtyPaths,
  EXPECTED_DIRTY_PATHS,
  type GitRunner,
} from '../src/core/vendors.ts';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

interface FakeCall {
  readonly op:
    | 'clone'
    | 'checkout'
    | 'revParse'
    | 'isGitRepo'
    | 'isDirty'
    | 'getDirtyPaths';
  readonly args: readonly string[];
}

interface FakeGitState {
  headByDir: Map<string, string>;
  dirtyDirs?: Set<string>;
  /** Per-directory dirty path list (for EXPECTED_DIRTY_PATHS testing). */
  dirtyPathsByDir?: Map<string, readonly string[]>;
  cloneBehavior?: (repoUrl: string, dir: string) => void;
  checkoutBehavior?: (dir: string, commit: string) => void;
  failRevParse?: boolean;
}

function makeFakeGit(state: FakeGitState): { git: GitRunner; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const git: GitRunner = {
    clone(repoUrl, dir) {
      calls.push({ op: 'clone', args: [repoUrl, dir] });
      if (state.cloneBehavior) {
        state.cloneBehavior(repoUrl, dir);
      } else {
        mkdirSync(join(dir, '.git'), { recursive: true });
        writeFileSync(join(dir, 'README.md'), '# test\n', 'utf8');
        state.headByDir.set(dir, SHA_A);
      }
    },
    checkout(dir, commit) {
      calls.push({ op: 'checkout', args: [dir, commit] });
      if (state.checkoutBehavior) {
        state.checkoutBehavior(dir, commit);
      } else {
        state.headByDir.set(dir, commit);
      }
    },
    revParse(dir) {
      calls.push({ op: 'revParse', args: [dir] });
      if (state.failRevParse) throw new Error('simulated rev-parse failure');
      const head = state.headByDir.get(dir);
      if (!head) throw new Error(`no head for ${dir}`);
      return head;
    },
    isGitRepo(dir) {
      calls.push({ op: 'isGitRepo', args: [dir] });
      return existsSync(join(dir, '.git'));
    },
    isDirty(dir) {
      calls.push({ op: 'isDirty', args: [dir] });
      if (state.dirtyPathsByDir?.has(dir)) {
        return (state.dirtyPathsByDir.get(dir) ?? []).length > 0;
      }
      return state.dirtyDirs?.has(dir) ?? false;
    },
    getDirtyPaths(dir) {
      calls.push({ op: 'getDirtyPaths', args: [dir] });
      const explicit = state.dirtyPathsByDir?.get(dir);
      if (explicit) return explicit;
      if (state.dirtyDirs?.has(dir)) return ['<unknown>'];
      return [];
    },
  };
  return { git, calls };
}

function makeWorkspace(): {
  dir: string;
  vendorsRoot: string;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-vendors-'));
  return {
    dir,
    vendorsRoot: join(dir, 'vendors'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('toRepoUrl: owner/name → https GitHub URL', () => {
  assert.equal(toRepoUrl('dotoricode/acorn'), 'https://github.com/dotoricode/acorn.git');
});

test('installVendor: 부재 → clone + checkout → cloned', () => {
  const w = makeWorkspace();
  try {
    const { git, calls } = makeFakeGit({ headByDir: new Map() });
    const r = installVendor({
      tool: 'omc',
      repo: 'org/omc',
      commit: SHA_B,
      vendorsRoot: w.vendorsRoot,
      git,
    });
    assert.equal(r.action, 'cloned');
    assert.equal(r.path, join(w.vendorsRoot, 'omc'));
    assert.equal(r.previousCommit, null);
    assert.equal(r.commit, SHA_B);
    const ops = calls.map((c) => c.op);
    assert.deepEqual(ops, ['clone', 'checkout', 'revParse']);
  } finally {
    w.cleanup();
  }
});

test('installVendor: 빈 디렉토리 → clone (기존 빈 폴더 제거)', () => {
  const w = makeWorkspace();
  try {
    mkdirSync(join(w.vendorsRoot, 'omc'), { recursive: true });
    const { git } = makeFakeGit({ headByDir: new Map() });
    const r = installVendor({
      tool: 'omc',
      repo: 'org/omc',
      commit: SHA_B,
      vendorsRoot: w.vendorsRoot,
      git,
    });
    assert.equal(r.action, 'cloned');
  } finally {
    w.cleanup();
  }
});

test('installVendor: 이미 정확한 SHA → noop (checkout/clone 미호출)', () => {
  const w = makeWorkspace();
  try {
    const path = join(w.vendorsRoot, 'omc');
    mkdirSync(join(path, '.git'), { recursive: true });
    const state: FakeGitState = { headByDir: new Map([[path, SHA_B]]) };
    const { git, calls } = makeFakeGit(state);
    const r = installVendor({
      tool: 'omc',
      repo: 'org/omc',
      commit: SHA_B,
      vendorsRoot: w.vendorsRoot,
      git,
    });
    assert.equal(r.action, 'noop');
    assert.equal(r.previousCommit, SHA_B);
    assert.equal(calls.some((c) => c.op === 'clone'), false);
    assert.equal(calls.some((c) => c.op === 'checkout'), false);
  } finally {
    w.cleanup();
  }
});

test('installVendor: 다른 SHA → checkout → checked_out', () => {
  const w = makeWorkspace();
  try {
    const path = join(w.vendorsRoot, 'omc');
    mkdirSync(join(path, '.git'), { recursive: true });
    const state: FakeGitState = { headByDir: new Map([[path, SHA_A]]) };
    const { git, calls } = makeFakeGit(state);
    const r = installVendor({
      tool: 'omc',
      repo: 'org/omc',
      commit: SHA_B,
      vendorsRoot: w.vendorsRoot,
      git,
    });
    assert.equal(r.action, 'checked_out');
    assert.equal(r.previousCommit, SHA_A);
    assert.equal(r.commit, SHA_B);
    const ops = calls.map((c) => c.op);
    // getDirtyPaths 가 구현되면 isDirty 를 건너뜀 (더 정밀한 정보로 대체).
    assert.deepEqual(ops, ['isGitRepo', 'revParse', 'getDirtyPaths', 'checkout', 'revParse']);
  } finally {
    w.cleanup();
  }
});

test('installVendor: dirty working tree → LOCAL_CHANGES', () => {
  const w = makeWorkspace();
  try {
    const path = join(w.vendorsRoot, 'omc');
    mkdirSync(join(path, '.git'), { recursive: true });
    const state: FakeGitState = {
      headByDir: new Map([[path, SHA_A]]),
      dirtyDirs: new Set([path]),
    };
    const { git } = makeFakeGit(state);
    assert.throws(
      () =>
        installVendor({
          tool: 'omc',
          repo: 'org/omc',
          commit: SHA_B,
          vendorsRoot: w.vendorsRoot,
          git,
        }),
      (err: unknown) =>
        err instanceof VendorError && err.code === 'LOCAL_CHANGES',
    );
  } finally {
    w.cleanup();
  }
});

test('installVendor: checkout 실패 시 partial clone 정리 → 다음 호출은 fresh clone', () => {
  const w = makeWorkspace();
  try {
    let checkoutFails = true;
    const state: FakeGitState = {
      headByDir: new Map(),
      checkoutBehavior: (dir, commit) => {
        if (checkoutFails) throw new Error('sim checkout fail');
        state.headByDir.set(dir, commit);
      },
    };
    const { git } = makeFakeGit(state);
    assert.throws(
      () =>
        installVendor({
          tool: 'omc',
          repo: 'org/omc',
          commit: SHA_B,
          vendorsRoot: w.vendorsRoot,
          git,
        }),
      (err: unknown) => err instanceof VendorError && err.code === 'CHECKOUT',
    );
    // partial clone 이 정리되어야 함
    assert.equal(existsSync(join(w.vendorsRoot, 'omc')), false);

    // 두 번째 호출: 이제 성공해야 함
    checkoutFails = false;
    const r = installVendor({
      tool: 'omc',
      repo: 'org/omc',
      commit: SHA_B,
      vendorsRoot: w.vendorsRoot,
      git,
    });
    assert.equal(r.action, 'cloned');
  } finally {
    w.cleanup();
  }
});

test('installVendor: git 저장소 아닌 기존 경로 → NOT_A_REPO', () => {
  const w = makeWorkspace();
  try {
    const path = join(w.vendorsRoot, 'omc');
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'stray.txt'), 'x', 'utf8');
    const { git } = makeFakeGit({ headByDir: new Map() });
    assert.throws(
      () =>
        installVendor({
          tool: 'omc',
          repo: 'org/omc',
          commit: SHA_B,
          vendorsRoot: w.vendorsRoot,
          git,
        }),
      (err: unknown) => err instanceof VendorError && err.code === 'NOT_A_REPO',
    );
  } finally {
    w.cleanup();
  }
});

test('installVendor: checkout 후 SHA 불일치 → SHA_MISMATCH', () => {
  const w = makeWorkspace();
  try {
    const { git } = makeFakeGit({
      headByDir: new Map(),
      cloneBehavior: (_repo, dir) => {
        mkdirSync(join(dir, '.git'), { recursive: true });
      },
      checkoutBehavior: () => {
        /* pretend checkout succeeded but head stays undefined → revParse throws */
      },
    });
    // Force revParse to return a wrong SHA instead of throw
    const badGit: GitRunner = {
      ...git,
      revParse: () => SHA_A,
    };
    assert.throws(
      () =>
        installVendor({
          tool: 'omc',
          repo: 'org/omc',
          commit: SHA_B,
          vendorsRoot: w.vendorsRoot,
          git: badGit,
        }),
      (err: unknown) => err instanceof VendorError && err.code === 'SHA_MISMATCH',
    );
  } finally {
    w.cleanup();
  }
});

test('installVendor: clone 실패 → CLONE 에러', () => {
  const w = makeWorkspace();
  try {
    const { git } = makeFakeGit({
      headByDir: new Map(),
      cloneBehavior: () => {
        throw new Error('network down');
      },
    });
    assert.throws(
      () =>
        installVendor({
          tool: 'omc',
          repo: 'org/omc',
          commit: SHA_B,
          vendorsRoot: w.vendorsRoot,
          git,
        }),
      (err: unknown) => err instanceof VendorError && err.code === 'CLONE',
    );
  } finally {
    w.cleanup();
  }
});

test('installVendor: 멱등 — 두 번째 호출은 noop', () => {
  const w = makeWorkspace();
  try {
    const { git } = makeFakeGit({ headByDir: new Map() });
    const r1 = installVendor({
      tool: 'omc',
      repo: 'org/omc',
      commit: SHA_B,
      vendorsRoot: w.vendorsRoot,
      git,
    });
    assert.equal(r1.action, 'cloned');
    const r2 = installVendor({
      tool: 'omc',
      repo: 'org/omc',
      commit: SHA_B,
      vendorsRoot: w.vendorsRoot,
      git,
    });
    assert.equal(r2.action, 'noop');
  } finally {
    w.cleanup();
  }
});

// ─── EXPECTED_DIRTY_PATHS (DOGFOOD Round 1 §v0.1.1 #5) ────────────────

test('EXPECTED_DIRTY_PATHS: gstack 에 .agents/ 등록됨', () => {
  assert.ok(EXPECTED_DIRTY_PATHS['gstack']?.includes('.agents/'));
  assert.deepEqual(EXPECTED_DIRTY_PATHS['omc'], []);
});

test('unexpectedDirtyPaths: prefix 매칭으로 허용 경로 필터', () => {
  // gstack 의 .agents/ 만 있으면 빈 배열 (= 정상 취급)
  assert.deepEqual(
    unexpectedDirtyPaths('gstack', ['.agents/skills/foo', '.agents/pkgs/bar']),
    [],
  );
  // .agents/ 외 다른 경로는 그대로 남음
  assert.deepEqual(
    unexpectedDirtyPaths('gstack', ['.agents/skills/foo', 'src/modified.ts']),
    ['src/modified.ts'],
  );
  // omc 는 허용 목록 없음 → 전부 unexpected
  assert.deepEqual(
    unexpectedDirtyPaths('omc', ['.agents/foo']),
    ['.agents/foo'],
  );
  // 모르는 툴 이름 → 전부 unexpected (안전 쪽)
  assert.deepEqual(
    unexpectedDirtyPaths('unknown-tool', ['whatever']),
    ['whatever'],
  );
});

test('installVendor: gstack 에 .agents/ 만 dirty → checkout 허용', () => {
  // DOGFOOD 증상: 첫 install 후 gstack setup 이 생성한 .agents/ 가 남아있어
  // 다음 install(새 SHA) 이 LOCAL_CHANGES 로 막히던 문제.
  const w = makeWorkspace();
  try {
    const path = join(w.vendorsRoot, 'gstack');
    mkdirSync(join(path, '.git'), { recursive: true });
    const heads = new Map<string, string>();
    heads.set(path, SHA_A);
    const { git } = makeFakeGit({
      headByDir: heads,
      dirtyPathsByDir: new Map([[path, ['.agents/skills/cli.md']]]),
    });
    const r = installVendor({
      tool: 'gstack',
      repo: 'org/gstack',
      commit: SHA_B,
      vendorsRoot: w.vendorsRoot,
      git,
    });
    assert.equal(r.action, 'checked_out');
    assert.equal(r.commit, SHA_B);
  } finally {
    w.cleanup();
  }
});

test('installVendor: gstack 에 .agents/ + 다른 파일 dirty → LOCAL_CHANGES', () => {
  // .agents/ 는 허용되지만 다른 경로가 섞이면 여전히 막아야 한다.
  const w = makeWorkspace();
  try {
    const path = join(w.vendorsRoot, 'gstack');
    mkdirSync(join(path, '.git'), { recursive: true });
    const heads = new Map<string, string>();
    heads.set(path, SHA_A);
    const { git } = makeFakeGit({
      headByDir: heads,
      dirtyPathsByDir: new Map([
        [path, ['.agents/skills/cli.md', 'src/main.ts']],
      ]),
    });
    assert.throws(
      () =>
        installVendor({
          tool: 'gstack',
          repo: 'org/gstack',
          commit: SHA_B,
          vendorsRoot: w.vendorsRoot,
          git,
        }),
      (err: unknown) =>
        err instanceof VendorError &&
        err.code === 'LOCAL_CHANGES' &&
        err.message.includes('src/main.ts'),
    );
  } finally {
    w.cleanup();
  }
});

test('installVendor: omc 에 .agents/ dirty → LOCAL_CHANGES (omc 는 허용 없음)', () => {
  const w = makeWorkspace();
  try {
    const path = join(w.vendorsRoot, 'omc');
    mkdirSync(join(path, '.git'), { recursive: true });
    const heads = new Map<string, string>();
    heads.set(path, SHA_A);
    const { git } = makeFakeGit({
      headByDir: heads,
      dirtyPathsByDir: new Map([[path, ['.agents/whatever']]]),
    });
    assert.throws(
      () =>
        installVendor({
          tool: 'omc',
          repo: 'org/omc',
          commit: SHA_B,
          vendorsRoot: w.vendorsRoot,
          git,
        }),
      (err: unknown) => err instanceof VendorError && err.code === 'LOCAL_CHANGES',
    );
  } finally {
    w.cleanup();
  }
});

test('installVendor: 경로가 파일이면 NOT_A_REPO 대신 IO 로 정확 번역 (§15 H4)', () => {
  // 이전 동작: readdirSync 가 ENOTDIR throw → catch 흡수 → false ("not empty") →
  //   else 분기에서 isGitRepo=false → NOT_A_REPO + "rm -rf" hint (잘못된 조치 유도)
  // 신규 동작: isEmptyDir 가 ENOENT 외 모든 에러 propagate → VendorError(IO)
  //   + "권한/소유자 확인" hint (파괴적이지 않은 안내)
  const w = makeWorkspace();
  try {
    const { git } = makeFakeGit({ headByDir: new Map() });
    mkdirSync(w.vendorsRoot, { recursive: true });
    // vendors/omc 를 파일로 만든다 (디렉토리 아님)
    writeFileSync(join(w.vendorsRoot, 'omc'), '이 경로는 파일', 'utf8');

    assert.throws(
      () =>
        installVendor({
          tool: 'omc',
          repo: 'org/omc',
          commit: SHA_A,
          vendorsRoot: w.vendorsRoot,
          git,
        }),
      (e: unknown) =>
        e instanceof VendorError &&
        e.code === 'IO' &&
        // 에러 코드가 IO 인 것이 핵심 (이전 동작이면 NOT_A_REPO 였을 것)
        /접근 실패|ENOTDIR/.test(e.message),
    );
  } finally {
    w.cleanup();
  }
});

test('installVendor: adopt=true + non-git 디렉토리 → preAdoptMove + clone (§15 S4)', () => {
  const w = makeWorkspace();
  try {
    const { git } = makeFakeGit({ headByDir: new Map() });
    // vendors/omc 에 git 아닌 기존 디렉토리 (수동 설치 시뮬)
    const existing = join(w.vendorsRoot, 'omc');
    mkdirSync(existing, { recursive: true });
    writeFileSync(join(existing, 'manual-install.txt'), 'user data', 'utf8');

    const result = installVendor({
      tool: 'omc',
      repo: 'org/omc',
      commit: SHA_A,
      vendorsRoot: w.vendorsRoot,
      git,
      adopt: true,
    });
    assert.equal(result.action, 'adopted');
    assert.ok(result.preAdoptPath, 'preAdoptPath 필드 반환');
    assert.ok(existsSync(result.preAdoptPath!));
    // 원본 사용자 파일은 pre-adopt 경로에 보존
    assert.equal(
      readFileSync(join(result.preAdoptPath!, 'manual-install.txt'), 'utf8'),
      'user data',
    );
    // 새 clone 이 자리 잡음
    assert.ok(existsSync(join(existing, '.git')));
  } finally {
    w.cleanup();
  }
});

test('installVendor: adopt=false (기본) + non-git 디렉토리 → NOT_A_REPO (regression guard)', () => {
  const w = makeWorkspace();
  try {
    const { git } = makeFakeGit({ headByDir: new Map() });
    const existing = join(w.vendorsRoot, 'omc');
    mkdirSync(existing, { recursive: true });
    writeFileSync(join(existing, 'manual.txt'), 'x', 'utf8');
    assert.throws(
      () =>
        installVendor({
          tool: 'omc',
          repo: 'org/omc',
          commit: SHA_A,
          vendorsRoot: w.vendorsRoot,
          git,
        }),
      (e: unknown) => e instanceof VendorError && e.code === 'NOT_A_REPO',
    );
    // 사용자 파일 건드리지 않음
    assert.ok(existsSync(join(existing, 'manual.txt')));
  } finally {
    w.cleanup();
  }
});

test('§15 B1 regression: 심링크 vendor + --follow-symlink 없음 → NOT_A_REPO 로 fail-close', () => {
  // v0.3.0 은 여기서 silent `preserved` 반환 → lock SHA 검증 없이 install success
  // 로 회귀. v0.3.1 B1 hotfix 는 명시적 opt-in 없는 심링크를 거부한다.
  const w = makeWorkspace();
  try {
    mkdirSync(w.vendorsRoot, { recursive: true });
    const target = join(w.dir, 'real-gstack');
    mkdirSync(target, { recursive: true });
    mkdirSync(join(target, '.git'), { recursive: true });
    const linkPath = join(w.vendorsRoot, 'gstack');
    try {
      symlinkSync(target, linkPath, 'dir');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') {
        // Windows 개발자 모드 미활성 — regression guard 는 POSIX/dev-mode 에서 유효
        return;
      }
      throw e;
    }
    const { git } = makeFakeGit({ headByDir: new Map([[linkPath, SHA_A]]) });
    assert.throws(
      () =>
        installVendor({
          tool: 'gstack',
          repo: 'org/gstack',
          commit: SHA_B,
          vendorsRoot: w.vendorsRoot,
          git,
        }),
      (e: unknown) => e instanceof VendorError && e.code === 'NOT_A_REPO',
    );
  } finally {
    w.cleanup();
  }
});

test('§15 B1: 심링크 vendor + --follow-symlink + HEAD 일치 → adopted', () => {
  const w = makeWorkspace();
  try {
    mkdirSync(w.vendorsRoot, { recursive: true });
    const target = join(w.dir, 'real-gstack');
    mkdirSync(target, { recursive: true });
    mkdirSync(join(target, '.git'), { recursive: true });
    const linkPath = join(w.vendorsRoot, 'gstack');
    try {
      symlinkSync(target, linkPath, 'dir');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') return;
      throw e;
    }
    const { git } = makeFakeGit({ headByDir: new Map([[linkPath, SHA_B]]) });
    const r = installVendor({
      tool: 'gstack',
      repo: 'org/gstack',
      commit: SHA_B,
      vendorsRoot: w.vendorsRoot,
      git,
      followSymlink: true,
    });
    assert.equal(r.action, 'adopted');
    assert.equal(r.previousCommit, SHA_B);
  } finally {
    w.cleanup();
  }
});

test('§15 H-3: 심링크 + --follow-symlink + target non-git → NOT_A_REPO', () => {
  // v0.3.3 까지: revParse throw 를 silent 흡수해 `preserved` 로 success 반환.
  // v0.3.4 H-3: target 이 git 저장소 아님을 isGitRepo 로 먼저 판정해 NOT_A_REPO 로 fail-close.
  const w = makeWorkspace();
  try {
    mkdirSync(w.vendorsRoot, { recursive: true });
    const target = join(w.dir, 'real-gstack');
    mkdirSync(target, { recursive: true });
    // .git 디렉토리 없음 — non-git
    const linkPath = join(w.vendorsRoot, 'gstack');
    try {
      symlinkSync(target, linkPath, 'dir');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') return;
      throw e;
    }
    const { git } = makeFakeGit({ headByDir: new Map() });
    assert.throws(
      () =>
        installVendor({
          tool: 'gstack',
          repo: 'org/gstack',
          commit: SHA_B,
          vendorsRoot: w.vendorsRoot,
          git,
          followSymlink: true,
        }),
      (e: unknown) =>
        e instanceof VendorError &&
        e.code === 'NOT_A_REPO' &&
        /심링크 target 이 git 저장소가 아님/.test(e.message),
    );
  } finally {
    w.cleanup();
  }
});

test('§15 H-3: 심링크 + --follow-symlink + revParse throw → REV_PARSE', () => {
  // target 은 git 저장소지만 revParse 가 실패 (git 바이너리 문제, 권한, 손상 등).
  // v0.3.3 까지: silent preserved. v0.3.4: 명시적 REV_PARSE.
  const w = makeWorkspace();
  try {
    mkdirSync(w.vendorsRoot, { recursive: true });
    const target = join(w.dir, 'real-gstack');
    mkdirSync(target, { recursive: true });
    mkdirSync(join(target, '.git'), { recursive: true });
    const linkPath = join(w.vendorsRoot, 'gstack');
    try {
      symlinkSync(target, linkPath, 'dir');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') return;
      throw e;
    }
    // failRevParse=true 로 revParse 가 항상 throw 하는 fake git
    const { git } = makeFakeGit({
      headByDir: new Map(),
      failRevParse: true,
    });
    assert.throws(
      () =>
        installVendor({
          tool: 'gstack',
          repo: 'org/gstack',
          commit: SHA_B,
          vendorsRoot: w.vendorsRoot,
          git,
          followSymlink: true,
        }),
      (e: unknown) =>
        e instanceof VendorError &&
        e.code === 'REV_PARSE' &&
        /심링크 target HEAD 읽기 실패/.test(e.message),
    );
  } finally {
    w.cleanup();
  }
});

test('§15 H-3: 심링크 + --follow-symlink + HEAD 불일치 → SHA_MISMATCH (drift 명시)', () => {
  // v0.3.3 까지: head !== commit 시 silent `preserved` 반환.
  // v0.3.4: drift 를 명시적으로 SHA_MISMATCH 로 fail-close.
  const w = makeWorkspace();
  try {
    mkdirSync(w.vendorsRoot, { recursive: true });
    const target = join(w.dir, 'real-gstack');
    mkdirSync(target, { recursive: true });
    mkdirSync(join(target, '.git'), { recursive: true });
    const linkPath = join(w.vendorsRoot, 'gstack');
    try {
      symlinkSync(target, linkPath, 'dir');
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES') return;
      throw e;
    }
    // target 의 HEAD 는 SHA_A 인데 lock 은 SHA_B 요구
    const { git } = makeFakeGit({ headByDir: new Map([[linkPath, SHA_A]]) });
    assert.throws(
      () =>
        installVendor({
          tool: 'gstack',
          repo: 'org/gstack',
          commit: SHA_B,
          vendorsRoot: w.vendorsRoot,
          git,
          followSymlink: true,
        }),
      (e: unknown) =>
        e instanceof VendorError &&
        e.code === 'SHA_MISMATCH' &&
        /drift 확정/.test(e.message),
    );
  } finally {
    w.cleanup();
  }
});

test('isEmptyDir (간접): existsSync 와 readdirSync 사이 race → ENOENT 는 empty 로 수용', () => {
  // existsSync 가 true 였다가 readdirSync 직전에 사라지는 race 는 현실적으로
  // 드물지만, 그 때 ENOENT 가 throw 되면 H4 fix 가 대상 외로 처리 — empty 간주.
  // 직접 시뮬레이션은 어렵지만, H4 의 의도를 문서화하는 pin-test.
  // (여기선 빈 디렉토리도 동일 분기이므로 clone 이 트리거되는지만 확인)
  const w = makeWorkspace();
  try {
    const { git, calls } = makeFakeGit({ headByDir: new Map() });
    mkdirSync(join(w.vendorsRoot, 'omc'), { recursive: true });
    // 빈 디렉토리 → clone 분기
    installVendor({
      tool: 'omc',
      repo: 'org/omc',
      commit: SHA_A,
      vendorsRoot: w.vendorsRoot,
      git,
    });
    assert.ok(calls.some((c) => c.op === 'clone'));
  } finally {
    w.cleanup();
  }
});
