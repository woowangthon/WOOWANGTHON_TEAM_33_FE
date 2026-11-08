# 외부 기술·데이터·자산

## 직접 구현한 부분

민원 접수·공통 접수함, 원문 보호 UI, 공식 법령 응답 파싱·조문 검색·시행일 필터, AI 호출 구성 및 구조화 검증, 문장별 근거와 요구 누락 검사, 사람 승인 흐름, 기록 보고서, 웹 음성 중계·차단·정제 텍스트 표시를 이 저장소에서 구현했다. AI 모델 자체나 통신망을 학습·개발한 것은 아니다. 개발 과정에서 Codex를 사용했다.

## 데이터와 모델

- [국가법령정보센터](https://www.law.go.kr/) / [법제처 OPEN API](https://open.law.go.kr/LSO/openApi/openApiManual.do): 공식 법령·청주시 자치법규를 서버에서 조회한다. 승인된 OC와 등록 서비스 주소가 필요하다. 원문 출처·조문·시행일을 표시하며 AI가 위법 여부를 자동 확정하지 않는다.
- [OpenAI API](https://platform.openai.com/docs): 민원 분석·검색어 생성·조문 재평가·검증 및 음성 인식/분류에 사용한다. 모델 ID는 실행 설정/코드에 기록되어 있다. 외부 API 사용료·계정별 접근권한은 별도다.
- [Gemini API](https://ai.google.dev/gemini-api/docs): 선택 가능한 텍스트 분석 공급자. OpenAI 장애 시 자동으로 다른 공급자를 사용하는 구조가 아니다.
- `lib/samples.ts`, `evals/complaints-40.json`: 팀 개발 과정에서 작성한 가상/합성 민원. 실제 시민의 민원 자료를 수집한 데이터셋이 아니다. 정답 후보 작성과 채점에 AI를 사용했고 사람 독립 검수는 아직 필요하다.
- `public/demo-audio/*.wav`: 합성 한국어 음원. 생성 모델/음성 및 대본은 같은 폴더의 `README.txt`에 기록했다. 실제 민원인 녹취가 아니며 입력을 전송한 이후의 STT·분류·정제는 실시간 API 처리다.

## 오픈소스와 서비스

주요 라이브러리: Next.js, React, TypeScript, lucide-react, pg, Zod, Vercel Workflow, @vercel/functions, @neondatabase/auth. 정확한 버전·전이 의존성은 `package-lock.json`, 라이선스 목록은 `dependency-licenses.json`을 참고한다. 누락된 메타데이터나 각 패키지의 추가 NOTICE/저작권 고지는 실제 배포 전 해당 패키지 원문으로 확인해야 한다.

호스팅/DB는 Vercel과 Neon, 로컬 음성 서버의 공개 터널은 [Cloudflare cloudflared](https://github.com/cloudflare/cloudflared)를 사용한다. cloudflared 실행 파일은 이 저장소에 재배포하지 않는다. `next/dist/compiled/ws` 내부 모듈에 의존하므로 Next.js를 바꾸면 음성 프로토콜 테스트도 다시 실행해야 한다.

## 시각 자산

- `public/favicon.svg`: 프로젝트에 포함된 SVG. 제3자 공식 기관 인증 마크를 사용했다는 뜻이 아니다.
- 아이콘: lucide-react의 라이선스/저작권 고지를 따른다.
- `public/images/portal-hero.jpg`: 현재 파일만으로 최초 제작자·생성 도구·원본 사용 조건을 확인하지 못했다. 출처 확인 전 이 자산의 권리 검토가 끝났다고 주장하지 않는다. 제출용 부록에 출처를 추가하거나 사용 권한이 명확한 자산으로 교체해야 한다.
- 사이트 디자인은 공공 민원 포털의 정보 구조를 참고한 시제품이다. 국민신문고나 청주시 공식 서비스로 소개하지 않는다.

## 검증 한계

테스트용 고정 응답, 과거 평가 결과, 예전 음성 자동 응대 실험은 `tests/`와 `evals/`의 개발 자료다. 현재 운영 기능과 분리해서 설명한다. Notion 기록은 Codex가 연결 도구를 통해 정리했으며, 실제로 사용하지 않은 Notion Agent 기능이나 팀 회의 이력을 만들지 않는다.
