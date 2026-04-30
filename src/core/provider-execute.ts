import { spawnSync } from 'node:child_process';
import { installVendor, type GitRunner } from './vendors.ts';
import { vendorsRoot } from './env.ts';
import type { HarnessLockV3 } from './lock.ts';
import { isCustomProvider, getProviderSource } from './providers.ts';
import { readProviderPolicy } from './provider-loader.ts';
import { AcornError } from './errors.ts';

export type ProviderExecuteErrorCode = 'CUSTOM_BLOCKED';

export class ProviderExecuteError extends AcornError<ProviderExecuteErrorCode> {
  constructor(
    message: string,
    code: ProviderExecuteErrorCode,
    hint?: string,
    docsUrl?: string,
  ) {
    super(message, { namespace: 'provider', code, hint, docsUrl });
    this.name = 'ProviderExecuteError';
  }
}

const PLACEHOLDER_SHA = '0'.repeat(40);

export type ProviderExecAction =
  | 'cloned'
  | 'noop'
  | 'npx-ran'
  | 'plugin-guidance'
  | 'skipped-placeholder';

export interface ProviderExecResult {
  readonly provider: string;
  readonly action: ProviderExecAction;
  readonly commit?: string;
  readonly detail?: string;
}

export interface NpxRunner {
  run(cmd: string): void;
}

export function defaultNpxRunner(): NpxRunner {
  return {
    run(cmd) {
      const parts = cmd.trim().split(/\s+/);
      const prog = parts[0] ?? '';
      const args = parts.slice(1);
      const res = spawnSync(prog, args, { stdio: 'inherit', shell: false });
      if (res.error) throw res.error;
      if (typeof res.status === 'number' && res.status !== 0) {
        throw new Error(`"${cmd}" exited with code ${res.status}`);
      }
    },
  };
}

export function collectActiveProviders(lock: HarnessLockV3): Set<string> {
  const active = new Set<string>();
  for (const cap of Object.values(lock.capabilities)) {
    for (const name of cap.providers) {
      active.add(name);
    }
  }
  return active;
}

export interface ExecuteV3ProvidersOptions {
  readonly harnessRoot: string;
  readonly git: GitRunner;
  readonly adopt?: boolean;
  readonly followSymlink?: boolean;
  readonly npxRunner?: NpxRunner;
  readonly log: (line: string) => void;
  /**
   * v0.9.5+: 사용자 정의 provider (env / user-file 출처) 의 install_cmd 실행 허용 여부.
   * 미지정 시 `<harnessRoot>/config.json` 의 `provider.allow_custom` 을 읽어 결정.
   * 기본값은 false — 차단 시 ProviderExecuteError/CUSTOM_BLOCKED throw.
   */
  readonly allowCustomProviders?: boolean;
}

export function executeV3Providers(
  lock: HarnessLockV3,
  opts: ExecuteV3ProvidersOptions,
): readonly ProviderExecResult[] {
  const active = collectActiveProviders(lock);
  const npx = opts.npxRunner ?? defaultNpxRunner();
  const vRoot = vendorsRoot(opts.harnessRoot);
  const results: ProviderExecResult[] = [];

  // v0.9.5+: 사용자 정의 provider 의 install_cmd 차단 정책. opts 로 명시되면
  // 그 값을 우선, 아니면 디스크 정책 파일 (`<harnessRoot>/config.json`) 을 읽는다.
  const allowCustom =
    opts.allowCustomProviders ?? readProviderPolicy(opts.harnessRoot).allowCustomProviders;

  for (const [name, entry] of Object.entries(lock.providers)) {
    if (!active.has(name)) {
      opts.log(`  [skip] ${name}: not referenced in any capability`);
      continue;
    }

    if (entry.install_strategy === 'git-clone') {
      if (entry.commit === PLACEHOLDER_SHA) {
        results.push({ provider: name, action: 'skipped-placeholder' });
        opts.log(`  [skip] ${name}: placeholder SHA — update harness.lock before installing`);
        continue;
      }
      const r = installVendor({
        tool: name,
        repo: entry.repo,
        commit: entry.commit,
        vendorsRoot: vRoot,
        git: opts.git,
        adopt: opts.adopt ?? false,
        followSymlink: opts.followSymlink ?? false,
      });
      const action: ProviderExecAction = r.action === 'noop' ? 'noop' : 'cloned';
      results.push({ provider: name, action, commit: r.commit });
      opts.log(`  ${name}: ${r.action} (${r.commit.slice(0, 7)})`);
    } else if (entry.install_strategy === 'plugin-marketplace') {
      // v0.9.2: acorn 은 Claude Code 외부에서 plugin marketplace 설치를 실행할
      // 수 없다 (CLI 내부 명령). 안내 문구만 출력하고 사용자 책임으로 위임.
      const cmd = `/plugin install ${entry.plugin}@${entry.marketplace}`;
      const detail = `claude  ${cmd}  (Claude Code 세션 안에서 실행)`;
      results.push({ provider: name, action: 'plugin-guidance', detail });
      opts.log(`  ${name}: plugin marketplace — ${detail}`);
    } else {
      // v0.9.5+: 사용자 정의 provider (env / user-file) 의 install_cmd 는 명시
      // opt-in 이 없으면 차단. lock 의 install_cmd 는 임의 shell 명령으로 실행
      // 되므로 신뢰할 수 없는 정의를 자동 실행하지 않는다.
      if (isCustomProvider(name) && !allowCustom) {
        const source = getProviderSource(name) ?? 'user-file';
        throw new ProviderExecuteError(
          `사용자 정의 provider "${name}" (출처: ${source}) 의 install_cmd 가 ` +
            `정책 (provider.allow_custom=false) 에 의해 차단되었습니다.`,
          'CUSTOM_BLOCKED',
          'acorn config provider.allow-custom true --yes 로 명시 opt-in 후 재실행. ' +
            'install_cmd 가 임의 shell 명령이므로 정의 출처를 검토하세요.',
        );
      }
      const cmd = entry.install_cmd;
      try {
        npx.run(cmd);
        results.push({ provider: name, action: 'npx-ran', detail: cmd });
        opts.log(`  ${name}: ran "${cmd}"`);
      } catch (e) {
        throw new Error(
          `Provider "${name}" install failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  return results;
}
