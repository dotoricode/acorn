import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type CapabilityName } from './lock.ts';
import { defaultHarnessRoot, phaseFilePath, presetFilePath } from './env.ts';

// ── preset definitions ────────────────────────────────────────────────────────

export const PRESET_NAMES = ['starter', 'builder', 'frontend', 'backend'] as const;
export type PresetName = (typeof PRESET_NAMES)[number];

export interface PresetDef {
  readonly name: PresetName;
  readonly description: string;
  readonly capabilities: readonly CapabilityName[];
}

export const PRESET_DEFS: Readonly<Record<PresetName, PresetDef>> = {
  starter: {
    name: 'starter',
    description: '가벼운 시작 — planning + review + hooks',
    capabilities: ['planning', 'review', 'hooks'],
  },
  builder: {
    name: 'builder',
    description: '풀스택 개발 워크플로우 — spec + tdd + review + hooks',
    capabilities: ['planning', 'spec', 'tdd', 'review', 'hooks'],
  },
  frontend: {
    name: 'frontend',
    description: 'UI 중심 — tdd + review + hooks + qa_ui',
    capabilities: ['planning', 'tdd', 'review', 'hooks', 'qa_ui'],
  },
  backend: {
    name: 'backend',
    description: 'API/서비스 — spec + tdd + review + hooks + qa_headless',
    capabilities: ['planning', 'spec', 'tdd', 'review', 'hooks', 'qa_headless'],
  },
};

// ── legacy alias ──────────────────────────────────────────────────────────────

export const LEGACY_PHASE_ALIAS: Readonly<Record<string, PresetName>> = {
  prototype: 'starter',
  dev: 'builder',
  production: 'builder',
};

export function isValidPresetName(v: unknown): v is PresetName {
  return typeof v === 'string' && (PRESET_NAMES as readonly string[]).includes(v);
}

export function resolveToPreset(value: string): PresetName | null {
  if (isValidPresetName(value)) return value;
  return LEGACY_PHASE_ALIAS[value] ?? null;
}

export function getPresetCapabilities(name: PresetName): readonly CapabilityName[] {
  return PRESET_DEFS[name].capabilities;
}

// ── storage ───────────────────────────────────────────────────────────────────

export type PresetStatus = 'ok' | 'missing' | 'invalid';

export interface PresetRead {
  readonly value: PresetName | null;
  readonly legacy: boolean;
  readonly status: PresetStatus;
  readonly path: string;
}

export function readPreset(harnessRoot?: string): PresetRead {
  const path = presetFilePath(harnessRoot);

  if (existsSync(path)) {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch {
      return { value: null, legacy: false, status: 'invalid', path };
    }
    const v = raw.replace(/^\uFEFF/, '').trim();
    if (isValidPresetName(v)) {
      return { value: v, legacy: false, status: 'ok', path };
    }
    return { value: null, legacy: false, status: 'invalid', path };
  }

  // Fall back to phase.txt legacy alias
  const phasePath = phaseFilePath(harnessRoot ?? defaultHarnessRoot());
  if (existsSync(phasePath)) {
    let raw: string;
    try {
      raw = readFileSync(phasePath, 'utf8');
    } catch {
      return { value: null, legacy: false, status: 'missing', path };
    }
    const v = raw.replace(/^\uFEFF/, '').trim();
    const resolved = resolveToPreset(v);
    if (resolved !== null) {
      return { value: resolved, legacy: true, status: 'ok', path: phasePath };
    }
  }

  return { value: null, legacy: false, status: 'missing', path };
}

export function writePreset(value: PresetName, harnessRoot?: string): void {
  const path = presetFilePath(harnessRoot);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.acorn-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, `${value}\n`, { encoding: 'utf8', mode: 0o644 });
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* best effort */ }
    throw e;
  }
}
