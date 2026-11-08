# Shield & Solve 공동 개발 안내

먼저 `AGENTS.md`와 `README.md`를 읽는다. 이 저장소는 Next.js 시민 사이트, 담당자 사이트, API, AI 처리, 음성 중계, 평가 자료를 함께 포함한다.

## 실행과 검사

- Node.js 24.x, `npm ci`.
- `.env.example`을 `.env.local`로 복사하고 개발용 값을 직접 설정한다. 실제 키와 운영 DB 값은 저장소에 없다.
- `npm run dev`, `npm run typecheck`, `npm test`, `npm run test:phone`, `npm run build`.
- DB 마이그레이션과 `*.integration.cjs`는 실제 DB에 쓰므로 개발용 DB 연결을 확인한다.
- `evals/run-*.cjs`와 실제 연결 검증 스크립트는 유료 API를 호출할 수 있다. 기존 결과는 `evals/results/`에서 읽을 수 있다.

## 코드 위치

- `app/citizen-portal.tsx`: 시민 접수·조회.
- `app/workspace.tsx`: 담당자 화면.
- `app/request-tracking-panel.tsx`, `lib/request-tracking*.ts`: 시민 요구 확인·수정·철회와 요구별 처리.
- `lib/analysis-stages.ts`, `workflows/`: 자동 분석과 재시도.
- `lib/coverage*.ts`: 요구 누락 검사·규칙 하네스.
- `lib/laws.ts`, `lib/semantic-search.ts`: 법령 수집·검색.
- `phone/`: 별도로 실행하는 웹 음성 중계 서버.

## 2026-11-08 인계 상태

- 시민 요구 확인·수정 및 요구별 상태 기능은 두 운영 사이트에 배포하고 실연결 검증을 마쳤다. `docs/REQUEST-TRACKING-RESULTS.md` 참조.
- 이후 화면의 반복 설명을 줄이는 수정이 소스에 포함돼 있다. 답변 누락 검사 접기, 정상 문장 검사 내역 접기, 표현 감지 요약, 개별 상태 변경 입력칸 접기다. 이 UI 수정은 아직 운영 배포·브라우저 검증 전이다.
- 남은 화면 정리: `workspace.tsx`의 중복 요구 목록·법령 목록과 긴 분석 영역을 정리하고 두 사이트 화면을 검증한다. 검증 실패·누락 경고와 원문 접근은 유지한다.
- 새 합성 12건 평가는 개발 평가다. 독립 사람 검수나 전체 서비스 정확도 100%로 표현하지 않는다. 기존 40건 평가의 오경보 8개가 해결됐다는 의미도 아니다.
- 대회 최종 제출은 사용자가 보류했다. GitHub 소스 공유와 제출은 구분한다.

## 함께 작업할 때

- 시작 전 최신 커밋과 변경 파일을 확인한다. 다른 작업자의 미커밋 변경을 덮어쓰지 않는다.
- 기능별 브랜치를 사용하고, 작업 완료 시 변경 내용·검사 결과·남은 일을 커밋 또는 PR에 적는다.
- API 키, 실제 민원·DB 덤프, 환경파일, 실행 로그, `.vercel/`, `node_modules/`는 커밋하지 않는다.
- AI 오류를 고정 성공 답안으로 대체하지 않는다. 시민 원문과 요구 수정 이력, 답변 승인과 실제 처리 완료의 구분을 보존한다.
