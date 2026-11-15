# 민원사이 · MIND

2026 AI 우왕톤 W33. 민원 내용을 정리하고, 공식 법령을 근거로 담당자의 답변 작성을 돕는 웹 서비스입니다.

- [담당자 업무](https://shield-solve-staff.vercel.app/) · [민원인 홈페이지](https://shield-and-solve.vercel.app/)
- [담당자 전화 상담](https://shield-solve-staff.vercel.app/phone) · [민원인 전화 상담](https://shield-and-solve.vercel.app/phone)
- [팀 Notion](https://www.notion.so/41034d7f11c2810ea737dada0f8cea88)
- [최종 시연 영상 · 1분 59초](https://youtu.be/7-oxolmVdQg)
- [W33 프로젝트 아카이빙](https://github.com/woowangthon/hub/tree/W33)

공개 시연 사이트는 별도 계정이나 설치 없이 사용할 수 있습니다. 음성 상담은 담당자 화면에서 수신을 시작한 뒤 민원인이 연결하며, 각 기기의 마이크 권한과 헤드셋이 필요합니다. 배포된 음성 중계 서버는 AWS EC2에서 실행합니다.

## 기능

- 민원 접수, 자동 요약, 요청별 처리 상태 관리
- 직원 대상 공격 표현 감지 및 업무 내용 보존
- 공식 법령·자치법규 검색, 근거를 포함한 답변 초안, 담당자 검토·승인
- 웹 음성 상담, 실시간 전사, 보호 모드 전환, 통화 중 요청별 답변 지원
- 민원 이력, 검색, 삭제·휴지통 관리

## 구성

이 저장소에 웹 화면, 서버 API, AI 처리 흐름과 음성 중계 서버를 함께 관리합니다.

| 경로 | 역할 |
| --- | --- |
| `app/` | Next.js 화면과 API |
| `lib/` · `workflows/` | 분석, 법령 검색, 답변 검증, 비동기 처리 |
| `phone/` | WebSocket 음성 중계·전사·보호 처리 |
| `migrations/` | PostgreSQL 스키마 |
| `tests/` | 단위 테스트와 합성 테스트 입력 |
| `scripts/` | 실행·DB 설정·배포 도구 |

## AI와 외부 서비스

| 용도 | 제공자·기본 모델 |
| --- | --- |
| 민원 요약·분석, 답변 작성·검증 | OpenAI · `gpt-6-luna` |
| 실시간 음성 전사 | Google Gemini · `gemini-3.5-transcribe-live` |
| 음성 내용 분석·보호 판단 | Google Gemini · `gemini-3.5-flash-lite` |
| 통화 중 답변 지원 | Gemini · `gemini-3.5-flash-lite`, OpenAI 대체 경로 |

모델은 서버 환경 변수로 설정합니다. 공식 법령은 국가법령정보 공동활용 API로 조회합니다. 웹 호스팅은 Vercel, DB·인증은 Neon을 사용하며 음성 중계 서버는 별도 Node.js 프로세스로 실행합니다. 개발 과정에서 Codex를 사용했습니다. 자료·라이브러리 출처는 [SOURCES](docs/SOURCES.md)에 정리했습니다.

## 웹 실행

Node.js 24와 npm, PostgreSQL/Neon, 사용할 AI·법령 API 계정이 필요합니다.

```sh
npm ci
cp .env.example .env.local
npm run db:migrate
npm run dev
```

Windows PowerShell에서는 `cp` 대신 `Copy-Item`을 사용할 수 있습니다. DB 마이그레이션 전에 `.env.local`을 설정하세요.

- `DATABASE_URL` / `DATABASE_URL_UNPOOLED`: 애플리케이션 접속 / 마이그레이션용 접속
- `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `APP_SECRET`, `STAFF_EMAILS`: 인증·암호화·담당자 접근
- `SITE_MODE`: `citizen` 또는 `staff`; `STAFF_SITE_URL`, `CITIZEN_SITE_URL`: 각 사이트 주소
- `SERVICE_OPENAI_API_KEY`, `SERVICE_OPENAI_MODEL`: 웹 AI 처리
- `SERVICE_LAW_API_OC`, `SERVICE_LAW_ORIGIN`, `SERVICE_JURISDICTION`: 승인된 법령 API 설정
- `SERVICE_GEMINI_API_KEY`: 통화 중 답변 지원용 서버 키

민원인·담당자 사이트는 같은 코드를 서로 다른 `SITE_MODE`로 실행합니다. API 키와 DB 접속 정보는 서버 환경에만 설정합니다. `.env.local`과 실제 계정 정보는 Git에 포함하지 않습니다.

## 음성 서버 실행

1. `.env.phone.example`을 `.env.phone.local`로 복사하고 사이트 주소·허용 출처·포트를 설정합니다.
2. `.env.phone-comparison.example`을 `.env.phone-comparison.local`로 복사하여 `GEMINI_API_KEY`를 설정합니다.
3. 두 웹 프로젝트와 음성 서버에 같은 `PHONE_BRIDGE_SECRET`을 설정합니다.
4. [cloudflared](https://github.com/cloudflare/cloudflared)를 설치하고 `CLOUDFLARED_PATH`에 실행 파일 경로를 설정합니다.
5. `node scripts/start-phone.mjs`를 실행합니다. 실행기가 터널 주소를 담당자 사이트에 등록합니다.

웹 상담에는 마이크 권한과 HTTPS 연결이 필요합니다. `public/demo-audio/`의 시연 음원은 합성 자료입니다.

## 검증·빌드

```sh
npm test
npm run test:phone
npm run typecheck
npm run build
npm start
```

단위 테스트는 외부 AI 호출을 모의 처리합니다. 실제 API 연동에는 위 환경 설정이 필요합니다. Vercel 프로덕션 빌드에서는 알림·출처 스키마 마이그레이션이 실행되므로 `DATABASE_URL_UNPOOLED`를 설정해야 합니다.

## 팀

권도희 · 개발 및 제출 총괄 / 김지영 · 발표 및 디자인
