import { existsSync, rmSync, unlinkSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultClaudeRoot,
  defaultHarnessRoot,
  vendorsRoot,
} from '../core/env.ts';
import { defaultSettingsPath, removeEnvKeys } from '../core/settings.ts';
import { gstackSymlinkPath } from '../core/symlink.ts';
import { gstackSetupMarkerPath } from '../core/gstack-marker.ts';
import {
  defaultClaudeMdPath,
  applyClaudeMdStrip,
  type ClaudeMdStripAction,
} from '../core/claude-md.ts';
import { phaseFilePath } from '../core/env.ts';
import { backupDirTs } from '../core/time.ts';
import { AcornError } from '../core/errors.ts';

export type UninstallErrorCode = 'IO';

export class UninstallError extends AcornError<UninstallErrorCode> {
  constructor(
    message: string,
    code: UninstallErrorCode,
    hint?: string,
    docsUrl?: string,
  ) {
    super(message, { namespace: 'uninstall', code, hint, docsUrl });
    this.name = 'UninstallError';
  }
}

export interface UninstallOptions {
  readonly harnessRoot?: string;
  readonly claudeRoot?: string;
  readonly settingsPath?: string;
  readonly claudeMdPath?: string;
  readonly logger?: (line: string) => void;
}

export type SymlinkRemoveResult = 'removed' | 'absent' | 'not_a_symlink';

export interface UninstallResult {
  readonly settingsRemoved: readonly string[];
  readonly claudeMd: ClaudeMdStripAction;
  readonly symlink: SymlinkRemoveResult;
  readonly hookRemoved: boolean;
  readonly markerRemoved: boolean;
  readonly phaseTxtRemoved: boolean;
  readonly vendorsRemoved: boolean;
}

function removeSymlink(symlinkPath: string): SymlinkRemoveResult {
  if (!existsSync(symlinkPath)) {
    try {
      lstatSync(symlinkPath);
    } catch {
      return 'absent';
    }
  }
  let stat;
  try {
    stat = lstatSync(symlinkPath);
  } catch {
    return 'absent';
  }
  if (!stat.isSymbolicLink()) {
    return 'not_a_symlink';
  }
  try {
    unlinkSync(symlinkPath);
    return 'removed';
  } catch (e) {
    throw new UninstallError(
      `gstack 심링크 제거 실패: ${symlinkPath} (${e instanceof Error ? e.message : String(e)})`,
      'IO',
      `수동 제거: rm ${symlinkPath}`,
    );
  }
}

function removeFileIfExists(filePath: string): boolean {
  try {
    lstatSync(filePath);
  } catch {
    return false;
  }
  try {
    unlinkSync(filePath);
    return true;
  } catch (e) {
    throw new UninstallError(
      `파일 제거 실패: ${filePath} (${e instanceof Error ? e.message : String(e)})`,
      'IO',
    );
  }
}

function removeDirIfExists(dirPath: string): boolean {
  if (!existsSync(dirPath)) return false;
  try {
    rmSync(dirPath, { recursive: true, force: true });
    return true;
  } catch (e) {
    throw new UninstallError(
      `디렉토리 제거 실패: ${dirPath} (${e instanceof Error ? e.message : String(e)})`,
      'IO',
      `수동 제거: rm -rf ${dirPath}`,
    );
  }
}

export function runUninstall(opts: UninstallOptions = {}): UninstallResult {
  const log = opts.logger ?? (() => undefined);
  const harnessRoot = opts.harnessRoot ?? defaultHarnessRoot();
  const claudeRoot = opts.claudeRoot ?? defaultClaudeRoot();
  const settingsPath = opts.settingsPath ?? defaultSettingsPath();
  const claudeMdPath = opts.claudeMdPath ?? defaultClaudeMdPath(claudeRoot);
  const backupTs = backupDirTs();

  // 1. settings.json env 키 제거
  log('[1/7] settings.json env 키 제거');
  const settingsResult = removeEnvKeys({ settingsPath, harnessRoot, backupTs });
  if (settingsResult.removedKeys.length > 0) {
    log(`      제거됨: [${settingsResult.removedKeys.join(', ')}] (backup: ${settingsResult.backupPath ?? '-'})`);
  } else {
    log(`      env 키 없음: noop`);
  }

  // 2. CLAUDE.md phase 마커 제거
  log('[2/7] CLAUDE.md phase 마커 제거');
  const claudeMdResult = applyClaudeMdStrip({ claudeMdPath, harnessRoot, backupTs });
  switch (claudeMdResult.kind) {
    case 'stripped':
      log(`      stripped (backup: ${claudeMdResult.backup ?? '-'})`);
      break;
    case 'corrupt':
      log(`      ⚠️  마커 손상 (${claudeMdResult.reason}) — 수동 확인 필요`);
      break;
    case 'missing':
      log(`      CLAUDE.md 없음: noop`);
      break;
    case 'noop':
      log(`      마커 없음: noop`);
      break;
  }

  // 3. gstack 심링크 제거
  log('[3/7] gstack 심링크 제거');
  const symlinkPath = gstackSymlinkPath(claudeRoot);
  const symlinkResult = removeSymlink(symlinkPath);
  log(`      ${symlinkResult}: ${symlinkPath}`);

  // 4. guard hook 제거
  log('[4/7] guard hook 제거');
  const hookPath = join(harnessRoot, 'hooks', 'guard-check.sh');
  const hookRemoved = removeFileIfExists(hookPath);
  log(`      ${hookRemoved ? 'removed' : 'absent'}: ${hookPath}`);

  // 5. gstack setup marker 제거
  log('[5/7] gstack setup marker 제거');
  const markerPath = gstackSetupMarkerPath(harnessRoot);
  const markerRemoved = removeFileIfExists(markerPath);
  log(`      ${markerRemoved ? 'removed' : 'absent'}: ${markerPath}`);

  // 6. phase.txt 제거
  log('[6/7] phase.txt 제거');
  const phasePath = phaseFilePath(harnessRoot);
  const phaseTxtRemoved = removeFileIfExists(phasePath);
  log(`      ${phaseTxtRemoved ? 'removed' : 'absent'}: ${phasePath}`);

  // 7. vendors 디렉토리 제거
  log('[7/7] vendors 디렉토리 제거');
  const vRoot = vendorsRoot(harnessRoot);
  const vendorsRemoved = removeDirIfExists(vRoot);
  log(`      ${vendorsRemoved ? 'removed' : 'absent'}: ${vRoot}`);

  return {
    settingsRemoved: settingsResult.removedKeys,
    claudeMd: claudeMdResult,
    symlink: symlinkResult,
    hookRemoved,
    markerRemoved,
    phaseTxtRemoved,
    vendorsRemoved,
  };
}
