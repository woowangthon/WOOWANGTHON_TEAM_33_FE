# 기술·자료 출처

## 서비스 API

| 항목 | 사용 범위 | 출처·이용 조건 |
| --- | --- | --- |
| 국가법령정보 공동활용 API | 공식 법령·자치법규 검색 및 답변 근거 | [법제처](https://open.law.go.kr/LSO/openApi/openApiManual.do), 승인된 API 이용 조건 준수·원문 출처와 조문·시행일 표시 |
| OpenAI API | 웹 민원 분석·답변 및 설정에 따른 음성 처리 | [API 문서](https://platform.openai.com/docs), [이용 조건](https://openai.com/policies/services-agreement/) |
| Google Gemini API | 실시간 전사·보호 판단·통화 답변 지원 | [API 문서](https://ai.google.dev/gemini-api/docs), [이용 조건](https://ai.google.dev/gemini-api/terms) |

모델 ID와 설정은 README 및 환경 변수 예시에 기록되어 있습니다. 모델을 별도로 학습하거나 미세조정하지 않습니다.

## 포함된 데이터·음원

- `lib/samples.ts`, `tests/fixtures/`: 팀 제작 합성 민원 및 단위 테스트 입력.
- `lib/public-complaints.json`: [한국남동발전 환경관련 민원사항 현황](https://www.data.go.kr/data/15093026/fileData.do)의 13건. 공개 자료 출처를 대조하는 기능에 포함되어 있으며, 포털 이용허락범위는 제한 없음입니다. 원문 URL·접수일·파일 해시는 JSON에 보존합니다.
- `public/demo-audio/`: 합성 시연·안내 음원. 파일 설명과 대본은 같은 폴더의 README 및 JSON에 기록합니다.

## 오픈소스

| 라이브러리 | 잠금 파일 버전 | 라이선스 |
| --- | --- | --- |
| Next.js | 16.4.3 | MIT |
| React / React DOM | 19.2.6 | MIT |
| TypeScript | 5.9.3 | Apache-2.0 |
| lucide-react | 1.61.0 | ISC, 일부 아이콘 MIT |
| pg | 8.23.1 | MIT |
| Zod | 4.6.7 | MIT |
| Vercel Workflow | 5.2.3 | Apache-2.0 |
| @vercel/functions | 3.10.3 | Apache-2.0 |
| @neondatabase/auth | 0.6.0-beta | Apache-2.0 |
| @grpc/grpc-js / @grpc/proto-loader | 1.14.7 / 0.8.1 | Apache-2.0 |

전체 의존성 버전은 [package-lock.json](../package-lock.json), 라이선스 목록은 [dependency-licenses.json](dependency-licenses.json)을 참조합니다. 각 패키지에 포함된 LICENSE·NOTICE·저작권 고지를 유지합니다.

음성 서버의 HTTPS 터널은 [Cloudflare cloudflared](https://github.com/cloudflare/cloudflared)(Apache-2.0)를 사용합니다. 실행 파일은 별도로 설치합니다. 웹 호스팅은 [Vercel](https://vercel.com/), DB·인증은 [Neon](https://neon.tech/)을 사용합니다.
