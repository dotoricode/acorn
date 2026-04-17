import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_NAMES, type ToolName } from '../core/lock.ts';
import {
  collectStatus,
  type StatusReport,
  type CollectOptions,
  type ToolStatus,
} from './status.ts';
import {
  defaultGitRunner,
  unexpectedDirtyPaths,
  type GitRunner,
} from '../core/vendors.ts';
import { distinguishingPair } from '../core/sha-display.ts';

export type DoctorSeverity = 'critical' | 'warning' | 'info';
export type DoctorArea =
  | 'vendor'
  | 'env'
  | 'symlink'
  | 'tx'
  | 'lock'
  | 'settings';

export interface DoctorIssue {
  readonly area: DoctorArea;
  readonly severity: DoctorSeverity;
  readonly subject: string;
  readonly message: string;
  readonly hint: string;
}

export interface DoctorSummary {
  readonly critical: number;
  readonly warning: number;
  readonly info: number;
}

export interface DoctorReport {
  readonly status: StatusReport;
  readonly issues: readonly DoctorIssue[];
  readonly summary: DoctorSummary;
  readonly ok: boolean;
  readonly okCritical: boolean;
}

export interface DoctorOptions extends CollectOptions {
  readonly git?: GitRunner;
}

function checkVendorIntegrity(
  tool: ToolStatus,
  vendorPath: string,
  git: GitRunner,
): DoctorIssue | null {
  // Sprint 7 collectStatus 가 locked 으로 판정했더라도,
  // doctor 는 한 번 더 FS 를 훑어 디렉토리 부패 / dirty 상태를 잡는다.
  if (tool.state !== 'locked') return null;
  if (!existsSync(vendorPath)) {
    return {
      area: 'vendor',
      severity: 'critical',
      subject: tool.tool,
      message: `vendor 경로 소멸: ${vendorPath}`,
      hint: 'acorn install 재실행',
    };
  }
  try {
    const entries = readdirSync(vendorPath);
    if (entries.length === 0) {
      return {
        area: 'vendor',
        severity: 'critical',
        subject: tool.tool,
        message: `vendor 디렉토리가 비어있음: ${vendorPath}`,
        hint: 'acorn install 로 재clone',
      };
    }
  } catch (e) {
    return {
      area: 'vendor',
      severity: 'critical',
      subject: tool.tool,
      message: `vendor 읽기 실패: ${e instanceof Error ? e.message : String(e)}`,
      hint: '디스크 권한 / 파일시스템 확인 후 재실행',
    };
  }
  try {
    // 툴별 EXPECTED_DIRTY_PATHS (예: gstack 의 .agents/) 는 setup 부산물로 간주.
    const paths = git.getDirtyPaths
      ? git.getDirtyPaths(vendorPath)
      : git.isDirty(vendorPath)
        ? (['<unknown>'] as const)
        : ([] as const);
    const unexpected = unexpectedDirtyPaths(tool.tool, paths);
    if (unexpected.length > 0) {
      return {
        area: 'vendor',
        severity: 'warning',
        subject: tool.tool,
        message:
          `vendor 에 로컬 변경이 있음: ${vendorPath} ` +
          `(paths: ${unexpected.slice(0, 5).join(', ')}${unexpected.length > 5 ? ' ...' : ''})`,
        hint:
          'git -C <path> status 로 확인 후 커밋·스태시·버림 중 선택. ' +
          'acorn install 은 dirty tree 를 감지하면 중단됨.',
      };
    }
  } catch (e) {
    // dirty 감지 실패를 silent 흡수하면 "install 은 거부 / doctor 는 통과" silent-lie 발생 (§15 C6).
    // warning 으로 노출해 사용자가 수동 확인하도록 유도한다.
    return {
      area: 'vendor',
      severity: 'warning',
      subject: tool.tool,
      message:
        `dirty 상태 감지 실패: ${vendorPath} ` +
        `(${e instanceof Error ? e.message : String(e)})`,
      hint:
        `git -C ${vendorPath} status --porcelain 을 수동 실행해 저장소 ` +
        '권한·잠금·손상 여부 확인. 확인 전에는 dirty 여부 불명확 상태.',
    };
  }
  return null;
}

function toolIssues(
  tool: ToolStatus,
  vendorPath: string,
  git: GitRunner,
): DoctorIssue[] {
  const issues: DoctorIssue[] = [];
  switch (tool.state) {
    case 'missing':
      issues.push({
        area: 'vendor',
        severity: 'critical',
        subject: tool.tool,
        message: `vendor 미설치: ${tool.tool} (기대 SHA ${tool.lockCommit.slice(0, 7)})`,
        hint: 'acorn install 을 실행하면 자동 clone',
      });
      break;
    case 'drift': {
      // §15 v0.2.0 S2: 차이 나는 위치까지 확장해 "같아 보이는" 착시 방지.
      const [lockDisp, actualDisp] = distinguishingPair(
        tool.lockCommit,
        tool.actualCommit,
      );
      issues.push({
        area: 'vendor',
        severity: 'warning',
        subject: tool.tool,
        message: `${tool.tool} SHA 불일치 (lock=${lockDisp}, 실제=${actualDisp})`,
        hint:
          '의도적 변경이면 harness.lock 갱신. ' +
          '아니면 dirty 없음을 확인한 뒤 acorn install 로 재checkout',
      });
      break;
    }
    case 'error':
      issues.push({
        area: 'vendor',
        severity: 'critical',
        subject: tool.tool,
        message: `${tool.tool} rev-parse 실패: ${tool.error ?? 'unknown'}`,
        hint: `git -C ${vendorPath} status 로 저장소 건강도 확인`,
      });
      break;
    case 'locked': {
      const integrity = checkVendorIntegrity(tool, vendorPath, git);
      if (integrity) issues.push(integrity);
      break;
    }
  }
  return issues;
}

function envIssues(status: StatusReport): DoctorIssue[] {
  const out: DoctorIssue[] = [];
  // settings.json 기반 이슈 (기존)
  const settingsOkKeys = new Set<string>();
  for (const e of status.env) {
    if (e.status === 'match') {
      settingsOkKeys.add(e.key);
      continue;
    }
    out.push({
      area: 'env',
      severity: e.status === 'missing' ? 'warning' : 'critical',
      subject: e.key,
      message:
        e.status === 'missing'
          ? `${e.key} 미설정 (기대="${e.expected}")`
          : `${e.key} 불일치 (현재="${e.actual}", 기대="${e.expected}")`,
      hint:
        e.status === 'missing'
          ? 'acorn install 이 settings.json 에 추가'
          : 'settings.json 을 수동으로 정리 후 acorn install',
    });
  }
  // §15 M3: settings 는 정확하지만 runtime (process.env) 은 미반영인 경우.
  // Claude Code 세션이 설치 후 reload 안 했다는 뜻 → info severity 로 안내.
  for (const r of status.envRuntime) {
    if (r.status === 'match') continue;
    if (!settingsOkKeys.has(r.key)) continue; // settings 도 틀리면 위에서 이미 보고
    out.push({
      area: 'env',
      severity: 'info',
      subject: r.key,
      message:
        `${r.key} 는 settings.json 기준 정확하나 Claude Code 세션 runtime 에 반영 안 됨 ` +
        `(runtime="${r.actual ?? '(undefined)'}")`,
      hint:
        'Claude Code 를 완전히 재시작하거나 새 세션 열어서 settings reload. ' +
        'direnv 사용 시 direnv allow 재실행 가능.',
    });
  }
  return out;
}

function symlinkIssues(status: StatusReport): DoctorIssue[] {
  const gs = status.gstackSymlink;
  if (gs.status === 'correct') return [];
  switch (gs.status) {
    case 'absent':
      return [{
        area: 'symlink',
        severity: 'critical',
        subject: 'gstack',
        message: `gstack 심링크 부재: ${gs.target}`,
        hint: 'acorn install 재실행하면 자동 생성',
      }];
    case 'wrong_target':
      return [{
        area: 'symlink',
        severity: 'warning',
        subject: 'gstack',
        message: `gstack 심링크가 엉뚱한 곳을 가리킴: ${gs.currentLink}`,
        hint: 'acorn install 이 원자 교체',
      }];
    case 'not_a_symlink':
      return [{
        area: 'symlink',
        severity: 'critical',
        subject: 'gstack',
        message: `${gs.target} 이 심링크가 아닌 일반 경로 (사용자 데이터 의심)`,
        hint: '내용 확인 후 수동 제거. acorn install 은 NOT_SYMLINK 로 거부함',
      }];
  }
}

function txIssues(status: StatusReport): DoctorIssue[] {
  if (!status.pendingTx) return [];
  return [{
    area: 'tx',
    severity: 'critical',
    subject: 'tx.log',
    message:
      `이전 설치 미완료 (phase=${status.pendingTx.phase ?? 'begin'}, ` +
      `ts=${status.pendingTx.ts})`,
    hint:
      `${status.harnessRoot}/tx.log 확인 후 상태가 정상이면 ` +
      'acorn install --force 로 재실행',
  }];
}

export function runDoctor(opts: DoctorOptions = {}): DoctorReport {
  const status = collectStatus(opts);
  const git = opts.git ?? defaultGitRunner;
  const vRoot = join(status.harnessRoot, 'vendors');

  const issues: DoctorIssue[] = [];
  for (const name of TOOL_NAMES) {
    issues.push(...toolIssues(status.tools[name as ToolName], join(vRoot, name), git));
  }
  issues.push(...envIssues(status));
  issues.push(...symlinkIssues(status));
  issues.push(...txIssues(status));

  const summary: DoctorSummary = {
    critical: issues.filter((i) => i.severity === 'critical').length,
    warning: issues.filter((i) => i.severity === 'warning').length,
    info: issues.filter((i) => i.severity === 'info').length,
  };

  return {
    status,
    issues,
    summary,
    ok: summary.critical === 0 && summary.warning === 0,
    okCritical: summary.critical === 0,
  };
}

function severityIcon(s: DoctorSeverity): string {
  switch (s) {
    case 'critical':
      return '⛔';
    case 'warning':
      return '⚠️';
    case 'info':
      return 'ℹ️';
  }
}

export function renderDoctor(r: DoctorReport): string {
  const lines: string[] = [];
  lines.push(`acorn doctor  •  ${r.status.harnessRoot}`);
  lines.push('─'.repeat(60));
  if (r.issues.length === 0) {
    lines.push('✅ 이슈 없음. 설치 상태 정상.');
    return lines.join('\n');
  }
  lines.push(
    `발견된 이슈: critical=${r.summary.critical} warning=${r.summary.warning} info=${r.summary.info}`,
  );
  lines.push('');
  for (const issue of r.issues) {
    lines.push(`${severityIcon(issue.severity)}  [${issue.area}] ${issue.subject}`);
    lines.push(`   ${issue.message}`);
    lines.push(`   → ${issue.hint}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

export function renderDoctorJson(r: DoctorReport): string {
  return JSON.stringify(
    {
      ok: r.ok,
      okCritical: r.okCritical,
      summary: r.summary,
      harnessRoot: r.status.harnessRoot,
      acornVersion: r.status.acornVersion,
      issues: r.issues,
      tools: r.status.tools,
      env: r.status.env,
      gstackSymlink: r.status.gstackSymlink,
      pendingTx: r.status.pendingTx,
    },
    null,
    2,
  );
}

