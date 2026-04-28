// src/core/errors.ts
// v0.9.4+ — acorn 의 모든 명시적 에러의 공통 베이스.
//
// 기존 11 개 에러 클래스 (InstallError / LockError / ConfigError / PresetError /
// PhaseError / UninstallError / VendorError / SettingsError / SymlinkError /
// HooksError / ClaudeMdError) 가 이 `AcornError` 를 상속한다. 호환성을 위해
// 각 서브클래스의 positional constructor 시그니처와 `.code` / `.name` 필드는
// 100% 보존된다 — 테스트의 `instanceof InstallError && e.code === 'X'` 단언이
// 그대로 통과한다.
//
// 표준 출력 포맷:
//   [namespace/CODE] 한국어 message
//      Hint: 사용자 복구 안내 (선택)
//      See:  https://github.com/dotoricode/acorn/... (선택)

const REPO_BASE = 'https://github.com/dotoricode/acorn';

export interface AcornErrorInit<TCode extends string = string> {
  readonly namespace: string;
  readonly code: TCode;
  readonly hint?: string | undefined;
  readonly docsUrl?: string | undefined;
  readonly cause?: unknown;
}

/**
 * acorn 의 모든 명시적 에러의 베이스.
 * - `namespace`: 'install' | 'lock' | 'config' | ... — CLI 헤더 prefix.
 * - `code`: 서브클래스에서 좁혀진 string literal union (PARSE / SCHEMA / IO / ...).
 * - `hint`: 사용자에게 보여줄 복구 안내 (한국어 우선).
 * - `docsUrl`: 자세한 문서 URL (`docsUrl()` 헬퍼 사용 권장).
 * - `cause`: ES2022 native Error.cause 로 위임.
 */
export class AcornError<TCode extends string = string> extends Error {
  readonly code: TCode;
  readonly namespace: string;
  readonly hint?: string;
  readonly docsUrl?: string;

  constructor(message: string, init: AcornErrorInit<TCode>) {
    super(
      message,
      init.cause !== undefined ? { cause: init.cause } : undefined,
    );
    this.name = 'AcornError';
    this.namespace = init.namespace;
    this.code = init.code;
    if (init.hint !== undefined) this.hint = init.hint;
    if (init.docsUrl !== undefined) this.docsUrl = init.docsUrl;
  }
}

export function isAcornError(e: unknown): e is AcornError {
  return e instanceof AcornError;
}

/**
 * CLI 에러 한 덩어리 렌더링.
 *   [namespace/CODE] message
 *      Hint: ...
 *      See:  ...
 *
 * 호출 측은 보통 `io.stderr(formatAcornError(e))` 한 줄.
 * line 단위 들여쓰기는 v0.3.x 부터 사용해 온 `   → hint` 와 호환되는 폭(3 spaces)을 유지한다.
 */
export function formatAcornError(e: AcornError): string {
  const head = `[${e.namespace}/${e.code}] ${e.message}`;
  const lines: string[] = [head];
  if (e.hint !== undefined && e.hint.length > 0) {
    lines.push(`   Hint: ${e.hint}`);
  }
  if (e.docsUrl !== undefined && e.docsUrl.length > 0) {
    lines.push(`   See:  ${e.docsUrl}`);
  }
  return lines.join('\n');
}

/**
 * docs URL 헬퍼 — `@dotoricode/acorn` GitHub 저장소 기준.
 *
 * - 절대 URL (`https://...`) → 그대로 반환
 * - `#anchor` 시작 → README anchor (`<repo>#anchor`)
 * - 그 외 → `<repo>/blob/main/<path>` 로 정규화 (앞쪽 `/` 제거)
 */
export function docsUrl(path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  if (path.startsWith('#')) return `${REPO_BASE}#${path.slice(1)}`;
  return `${REPO_BASE}/blob/main/${path.replace(/^\/+/, '')}`;
}
