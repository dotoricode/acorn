# Sprint 06 Prompt

## Goal

status 와 doctor 를 capability/provider 중심으로 확장해줘.

이번 sprint 의 핵심은 “현재 뭐가 켜져 있고, 뭐가 빠져 있으며, 뭘 해야 하는지”를  
한눈에 보이게 만드는 것이다.

## What To Build

대상:

- `src/commands/status.ts`
- `src/commands/doctor.ts`

## Status Should Show

최소한 아래를 보여줘.

1. active preset
2. enabled capabilities
3. capability -> provider 매핑
4. provider detect 상태
5. legacy phase 상태도 필요하면 같이 표시

## Doctor Should Report

최소한 아래 경고를 지원해줘.

- capability enabled but provider missing
- provider installed but lock mismatch
- recommended capability missing
- `qa_headless` recommended but no provider configured
- hooks capability enabled but hooks provider missing

## Rules

- status 는 요약 중심
- doctor 는 행동 가능한 경고 중심
- false positive 를 줄일 것
- legacy v2 상태 확인 기능은 깨지지 않게 유지

## Tests

- `tests/status-v3.test.ts`
- `tests/doctor-v3.test.ts`

포함할 것:

- v3 lock status 출력
- provider missing 경고
- qa_headless 경고
- legacy path regression

## Done

- status 만 봐도 현재 스택을 이해 가능
- doctor 가 바로 다음 행동을 알려줌

## Output Format

1. 새 status 예시
2. 새 doctor 예시
3. v2/v3 공존 방식
4. 남은 진단 리스크
