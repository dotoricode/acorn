import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { defaultHarnessRoot } from '../core/env.ts';
import { stripBom } from '../core/bom.ts';
import {
  defaultProvidersDir,
  validateProviderDef,
  ProviderLoaderError,
  type ProviderDef,
} from '../core/provider-loader.ts';
import {
  clearProviderCache,
  listLoadedProviders,
  listProviderWarnings,
  type LoadedProvider,
  type ProviderSource,
} from '../core/providers.ts';

/**
 * v0.9.5+: `acorn provider` — 사용자 정의 provider 레지스트리 운영.
 *
 * 서브커맨드:
 *   list      builtin + user-file + env 통합 목록 + source/warning 표시
 *   add <p>   <p> 가 가리키는 *.json 을 검증한 뒤 `<harnessRoot>/providers/`
 *             로 복사 (이미 같은 이름 존재 → ALREADY_EXISTS, --force 로 덮어쓰기)
 */

export type ProviderActionKind = 'list' | 'add' | 'noop';

export interface ProviderListAction {
  readonly kind: 'list';
  readonly providers: readonly LoadedProvider[];
  readonly warnings: readonly string[];
}

export interface ProviderAddAction {
  readonly kind: 'add';
  readonly name: string;
  readonly from: string;
  readonly to: string;
  readonly overwritten: boolean;
}

export type ProviderAction = ProviderListAction | ProviderAddAction;

export interface ProviderOptions {
  readonly harnessRoot?: string;
  readonly force?: boolean;
}

export function runProviderList(opts: ProviderOptions = {}): ProviderAction {
  // 디스크/env 가 막 변경된 직후 호출도 신선한 결과를 보장.
  clearProviderCache();
  const providers = listLoadedProviders();
  const warnings = listProviderWarnings();
  return { kind: 'list', providers, warnings };
}

export function runProviderAdd(
  inputPath: string | undefined,
  opts: ProviderOptions = {},
): ProviderAction {
  if (!inputPath) {
    throw new ProviderLoaderError(
      'acorn provider add <path-to-json> 사용법: 추가할 *.json 경로 필수',
      'IO',
      '예: acorn provider add ./my-provider.json',
    );
  }
  const src = resolve(inputPath);
  if (!existsSync(src)) {
    throw new ProviderLoaderError(
      `provider 파일을 찾을 수 없습니다: ${src}`,
      'IO',
    );
  }

  // 검증 — 잘못된 정의를 디스크에 복사하지 않는다.
  let raw: unknown;
  try {
    raw = JSON.parse(stripBom(readFileSync(src, 'utf8')));
  } catch (e) {
    throw new ProviderLoaderError(
      `JSON 파싱 실패: ${src} (${e instanceof Error ? e.message : String(e)})`,
      'PARSE',
    );
  }
  const def: ProviderDef = validateProviderDef(src, raw);

  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();
  const dir = defaultProvidersDir(harnessRoot);
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${def.name}.json`);
  const overwritten = existsSync(dest);
  if (overwritten && !opts.force) {
    throw new ProviderLoaderError(
      `provider "${def.name}" 가 이미 존재합니다: ${dest}`,
      'IO',
      'acorn provider add <path> --force 로 덮어쓰기',
    );
  }

  copyFileSync(src, dest);
  // 캐시 무효화 — 다음 listProviders() 가 새 파일을 본다.
  clearProviderCache();

  return {
    kind: 'add',
    name: def.name,
    from: src,
    to: dest,
    overwritten,
  };
}

// ── rendering ──────────────────────────────────────────────────────────────

const SOURCE_TAG: Record<ProviderSource, string> = {
  builtin: 'builtin   ',
  env: 'env       ',
  'user-file': 'user-file ',
};

export function renderProviderAction(a: ProviderAction): string {
  if (a.kind === 'add') {
    const verb = a.overwritten ? '덮어씀' : '복사 완료';
    return `✅ provider "${a.name}" ${verb}\n   from: ${a.from}\n   to:   ${a.to}`;
  }
  // list
  const lines: string[] = ['Providers:'];
  if (a.providers.length === 0) {
    lines.push('  (empty)');
  } else {
    for (const p of a.providers) {
      const tag = SOURCE_TAG[p.source];
      const cap = p.def.capabilities
        .map((c) => `${c.name}/${c.strength}`)
        .join(',');
      const where = p.path ? `   ${p.path}` : '';
      lines.push(
        `  [${tag}] ${p.def.name.padEnd(16)} → ${p.def.primaryStrategy.padEnd(8)} ${cap}` +
          (where ? `\n              ${where}` : ''),
      );
    }
  }
  if (a.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of a.warnings) lines.push(`  ⚠️  ${w}`);
  }
  return lines.join('\n');
}
