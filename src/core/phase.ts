import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { phaseFilePath } from './env.ts';

export const PHASES = ['prototype', 'dev', 'production'] as const;
export type Phase = (typeof PHASES)[number];
export type PhaseStatus = 'ok' | 'missing' | 'invalid';

export interface PhaseRead {
  readonly value: Phase | null;
  readonly status: PhaseStatus;
  readonly path: string;
}

export function isValidPhase(v: unknown): v is Phase {
  return typeof v === 'string' && (PHASES as readonly string[]).includes(v);
}

export function readPhase(harnessRoot?: string): PhaseRead {
  const path = phaseFilePath(harnessRoot);
  if (!existsSync(path)) {
    return { value: null, status: 'missing', path };
  }
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { value: null, status: 'invalid', path };
  }
  const v = raw.replace(/^\uFEFF/, '').trim();
  if (isValidPhase(v)) {
    return { value: v, status: 'ok', path };
  }
  return { value: null, status: 'invalid', path };
}

export function writePhase(value: Phase, harnessRoot?: string): void {
  const path = phaseFilePath(harnessRoot);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.acorn-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, `${value}\n`, { encoding: 'utf8', mode: 0o644 });
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort */
    }
    throw e;
  }
}

export function seedPhaseDefault(harnessRoot?: string): { seeded: boolean } {
  const path = phaseFilePath(harnessRoot);
  if (existsSync(path)) return { seeded: false };
  try {
    writePhase('dev', harnessRoot);
    return { seeded: true };
  } catch {
    return { seeded: false };
  }
}
