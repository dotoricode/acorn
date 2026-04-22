import { defaultHarnessRoot } from '../core/env.ts';
import {
  readPreset,
  writePreset,
  resolveToPreset,
  getPresetCapabilities,
  isValidPresetName,
  PRESET_NAMES,
  PRESET_DEFS,
  type PresetName,
  type PresetStatus,
} from '../core/preset.ts';
import { type ConfirmFn } from './config.ts';

export type PresetErrorCode = 'INVALID_VALUE' | 'IO' | 'CONFIRM_REQUIRED';

export class PresetError extends Error {
  readonly code: PresetErrorCode;
  readonly hint?: string;
  constructor(message: string, code: PresetErrorCode, hint?: string) {
    super(message);
    this.name = 'PresetError';
    this.code = code;
    if (hint !== undefined) this.hint = hint;
  }
}

export type PresetAction =
  | { kind: 'get'; value: PresetName | null; legacy: boolean; status: PresetStatus; path: string }
  | { kind: 'set'; from: PresetName | null; to: PresetName; resolvedFrom?: string }
  | { kind: 'noop'; value: PresetName }
  | { kind: 'cancelled'; from: PresetName | null; to: PresetName }
  | { kind: 'list' };

export interface PresetOptions {
  readonly harnessRoot?: string;
  readonly yes?: boolean;
  readonly confirm?: ConfirmFn;
}

function requireConfirm(prompt: string, opts: PresetOptions): boolean {
  if (opts.yes) return true;
  if (!opts.confirm) {
    throw new PresetError(
      `확인 프롬프트 불가 (non-TTY 또는 CI). --yes 플래그로 명시적 승인 필요`,
      'CONFIRM_REQUIRED',
      `acorn preset ${PRESET_NAMES.join('|')} --yes`,
    );
  }
  return opts.confirm(prompt);
}

export function runPreset(value: string | undefined, opts: PresetOptions = {}): PresetAction {
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();

  if (value === undefined) {
    const current = readPreset(harnessRoot);
    return {
      kind: 'get',
      value: current.value,
      legacy: current.legacy,
      status: current.status,
      path: current.path,
    };
  }

  if (value === 'list') {
    return { kind: 'list' };
  }

  const resolved = resolveToPreset(value);
  if (resolved === null) {
    throw new PresetError(
      `알 수 없는 preset: "${value}". ` +
        `${PRESET_NAMES.join('|')} 또는 legacy alias (prototype|dev|production) 이어야 합니다.`,
      'INVALID_VALUE',
      `acorn preset ${PRESET_NAMES.join('|')}`,
    );
  }

  const to: PresetName = resolved;
  const isAlias = !isValidPresetName(value);

  const current = readPreset(harnessRoot);
  const from = current.value;

  if (from === to) {
    return { kind: 'noop', value: to };
  }

  const fromLabel = from ?? 'unset';
  const toLabel = isAlias ? `${to} (${value} alias)` : to;
  const confirmed = requireConfirm(`preset 을 ${fromLabel} → ${toLabel} 로 변경합니다.`, opts);
  if (!confirmed) {
    return { kind: 'cancelled', from, to };
  }

  try {
    writePreset(to, harnessRoot);
  } catch (e) {
    throw new PresetError(
      `preset.txt 쓰기 실패: ${e instanceof Error ? e.message : String(e)}`,
      'IO',
    );
  }

  if (isAlias) {
    return { kind: 'set', from, to, resolvedFrom: value };
  }
  return { kind: 'set', from, to };
}

export function renderPresetAction(a: PresetAction): string {
  switch (a.kind) {
    case 'get': {
      if (a.value === null) {
        return a.status === 'missing'
          ? `preset: (미설정 — acorn preset ${PRESET_NAMES[0]} 으로 설정 가능)`
          : `preset: (잘못된 값 — ${a.path} 확인 후 acorn preset <값> 으로 재설정)`;
      }
      const legacyNote = a.legacy ? '  [legacy phase.txt 에서 읽음]' : '';
      const caps = getPresetCapabilities(a.value).join(', ');
      return `preset: ${a.value}${legacyNote}\n  capabilities: ${caps}\n  path: ${a.path}`;
    }
    case 'set': {
      const fromLabel = a.from ?? 'unset';
      const aliasNote = a.resolvedFrom !== undefined ? ` (${a.resolvedFrom} → ${a.to})` : '';
      const caps = getPresetCapabilities(a.to).join(', ');
      return `✅ preset 변경: ${fromLabel} → ${a.to}${aliasNote}\n  capabilities: ${caps}`;
    }
    case 'noop':
      return `preset: ${a.value}  (변경 없음 — 이미 해당 preset)`;
    case 'cancelled':
      return `취소됨: preset 변경 (${a.from ?? 'unset'} → ${a.to})`;
    case 'list': {
      const lines: string[] = ['사용 가능한 presets:'];
      for (const name of PRESET_NAMES) {
        const def = PRESET_DEFS[name];
        lines.push(`  ${name.padEnd(10)} ${def.description}`);
        lines.push(`             capabilities: ${def.capabilities.join(', ')}`);
      }
      lines.push('');
      lines.push('legacy alias: prototype→starter, dev→builder, production→builder');
      return lines.join('\n');
    }
  }
}
