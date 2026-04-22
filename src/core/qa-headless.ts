// qa_headless is a first-class capability even without a dedicated provider.
// When no provider is installed, this module supplies manual guidance per project type.

export type QaHeadlessProjectType = 'api' | 'worker' | 'cron' | 'webhook' | 'cli';

export const QA_HEADLESS_PROJECT_TYPES: readonly QaHeadlessProjectType[] = [
  'api',
  'worker',
  'cron',
  'webhook',
  'cli',
];

export interface QaHeadlessGuidance {
  readonly projectType: QaHeadlessProjectType;
  readonly checklist: readonly string[];
  readonly hint: string;
}

const GUIDANCE_MAP: Readonly<Record<QaHeadlessProjectType, Omit<QaHeadlessGuidance, 'projectType'>>> = {
  api: {
    checklist: [
      '핵심 엔드포인트 smoke test (200 / 4xx 응답 확인)',
      'Auth 경계 테스트 (401 / 403)',
      '요청 payload 유효성 — 잘못된 입력 → 4xx',
      '의존 서비스 없을 때 graceful degradation 확인',
    ],
    hint: 'curl / httpie / rest-client 로 수동 검증 가능 — provider 없어도 커버 가능',
  },
  worker: {
    checklist: [
      '작업 큐 enqueue → 처리 완료 확인',
      '실패 작업 재시도 / DLQ 이동 동작 확인',
      '처리 시간 SLA (타임아웃 내 완료)',
      '멱등성 — 동일 작업 2회 실행 시 부작용 없음',
    ],
    hint: 'unit 수준 queue mock + 통합 smoke test 로 provider 없이도 커버 가능',
  },
  cron: {
    checklist: [
      '수동 트리거 시 정상 실행',
      '중복 실행 방지 (locking 또는 idempotency key)',
      '실행 로그 / 알림 발송 확인',
      '스케줄 표현식 정확성',
    ],
    hint: '스케줄러 직접 실행 + 로그 검증으로 provider 없이 커버 가능',
  },
  webhook: {
    checklist: [
      '서명(HMAC/토큰) 검증 동작 확인',
      '페이로드 파싱 — 알려진 이벤트 타입 처리',
      '미지원 이벤트 → 2xx 응답 (200 또는 204)',
      '재전송(retry) 시 중복 처리 방지',
    ],
    hint: 'ngrok + curl 페이로드 재현으로 로컬 검증 가능 — provider 불필요',
  },
  cli: {
    checklist: [
      '주요 명령 기본 경로 실행 (exit code 0)',
      '--help / --version 출력 확인',
      '잘못된 인자 → 명확한 에러 메시지 + exit code 1',
      'stdin/stdout/stderr 분리 동작',
    ],
    hint: 'shell script + assert 로 E2E 가능 — provider 없이도 충분히 커버',
  },
};

export function qaHeadlessGuidance(projectType: QaHeadlessProjectType): QaHeadlessGuidance {
  return { projectType, ...GUIDANCE_MAP[projectType] };
}

export function qaHeadlessNoProviderMessage(projectType: QaHeadlessProjectType): string {
  const g = qaHeadlessGuidance(projectType);
  const lines: string[] = [
    `qa_headless [${g.projectType}] — 제공자 없음`,
    `힌트: ${g.hint}`,
    '',
    '체크리스트:',
    ...g.checklist.map((c) => `  • ${c}`),
  ];
  return lines.join('\n');
}
