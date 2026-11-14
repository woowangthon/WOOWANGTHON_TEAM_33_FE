# 외부 기술·데이터·자산

## 2026-11-15 제출용 자료

- [한국남동발전㈜ 환경관련 민원사항 현황_20220914](https://www.data.go.kr/data/15093026/fileData.do): 13건, 이용허락범위 제한 없음. `lib/public-complaints.json`에 민원내용·원본 접수일만 저장하고 기관 처리내용은 입력에서 제외한다. 기관 요약문이며 시민 전체 원문이 아니다. 원본 CSV SHA256: `4eb3db580d7ac8dfc8009620a2f6cde93ecc92288dcd18b515e34a20bbf0061f`.
- [2runo/Curse-detection-data](https://github.com/2runo/Curse-detection-data): MIT, Copyright (c) 2020 2runo, commit `ff241621e103b6f220d30de324d0d07987887308`. 5,825문장을 수집했으며 이번 통화 시험에는 댓글 2건을 사용했다. 실제 민원으로 표시하지 않는다. 원본과 LICENSE를 수집 폴더에 함께 보존한다.
- 음성 검증: Windows Microsoft Heami TTS로 공개 민원·MIT 댓글의 수정하지 않은 원문을 읽었다. 합성 음성이며 실제 민원인 녹음이 아니다. Gemini `gemini-3.5-transcribe-live` / `gemini-3.5-flash-lite`, 웹 분석은 OpenAI `gpt-6-luna` 설정으로 실제 호출했다.
- 기존 지자체 게시판 3건·합성 평가 자료는 과거 개발 기록이며 새 공개 시연 데이터에 포함하지 않는다. [현재 검증](SUBMISSION-2026-11-15.md)을 우선한다.

## 직접 구현한 부분

민원 접수·공통 접수함, 원문 보호 UI, 공식 법령 응답 파싱·조문 검색·시행일 필터, AI 호출 구성 및 구조화 검증, 문장별 근거와 요구 누락 검사, 사람 승인 흐름, 기록 보고서, 웹 음성 중계·차단·정제 텍스트 표시를 이 저장소에서 구현했다. AI 모델 자체나 통신망을 학습·개발한 것은 아니다. 개발 과정에서 Codex를 사용했다.

## 데이터와 모델

- [국가법령정보센터](https://www.law.go.kr/) / [법제처 OPEN API](https://open.law.go.kr/LSO/openApi/openApiManual.do): 공식 법령·청주시 자치법규를 서버에서 조회한다. 승인된 OC와 등록 서비스 주소가 필요하다. 원문 출처·조문·시행일을 표시하며 AI가 위법 여부를 자동 확정하지 않는다.
- [OpenAI API](https://platform.openai.com/docs): 민원 분석·검색어 생성·조문 재평가·검증 및 음성 인식/분류에 사용한다. 모델 ID는 실행 설정/코드에 기록되어 있다. 외부 API 사용료·계정별 접근권한은 별도다.
- `lib/samples.ts`, `evals/complaints-40.json`: 팀 개발 과정에서 작성한 가상/합성 민원. 실제 시민의 민원 자료를 수집한 데이터셋이 아니다. 정답 후보 작성과 채점에 AI를 사용했고 사람 독립 검수는 아직 필요하다.
- `public/demo-audio/*.wav`: 합성 한국어 음원. 생성 모델/음성 및 대본은 같은 폴더의 `README.txt`에 기록했다. 실제 민원인 녹취가 아니며 입력을 전송한 이후의 STT·분류·정제는 실시간 API 처리다.

## 실제 공개 민원 로컬 검토

기존 국민권익위원회 결정례 8건은 `evals/public-complaints/sources.json`에 출처를 기록했다. 기관이 편집한 신청원인 발췌이며 시민 제출 원문 전체라고 표시하지 않는다. 이후 아래 공개 게시판 3건으로 직접 욕설과 피해 신고·발화 대상 구분을 추가 확인했다. 기관 답변은 입력에서 제외했고 민원이나 욕설을 합성하지 않았다.

| 출처·게시일 | 사용 범위 | 수집 경로 |
| --- | --- | --- |
| [동대문구 · 빛과 소금이되는 공무원이기를](https://www.ddm.go.kr/chief/selectCvplRceptWebView.do?cvplCode=DSTLDR&key=1443&pageIndex=5313&pageUnit=10&rceptNo=14323&searchCnd=all) · 2020-05-20 | 흡연 단속 이의와 직원 직접 욕설의 감지·업무 요청 보존 | 공개 검색 색인 본문 스냅샷 |
| [기장군 · 대변방파제 내항 출입 제한 민원](https://www.gijang.go.kr/board/view.gijang?boardId=BBS_0000151&dataSid=218271&menuCd=DOM_000000102003009000&paging=ok&startPage=64) · 2023-08-16 | 제3자 욕설 피해 신고, 계도·사과문·구역 여부 요청 | 공식 사이트 HTML |
| [도봉구 · 반려견 배설물 과태료 요청](https://www.dobong.go.kr/subsite/ceo_frame/bbs.asp?bmode=D&intPage=163&pcode=12732925) · 2025-01-07 | 제3자 대상 거친 표현과 직접 공격 오분류, 업무 요약 | 공개 검색 색인 본문 스냅샷 |

수집 시각은 2026-11-14이며 자료별 URL·수집 경로·본문 해시를 보존한다. 검색 색인 자료를 현재 사이트 본문에서 직접 읽은 것으로 표시하지 않는다. 원문·참조 기준·실행 원본은 저장소 밖 로컬 평가 폴더에 보관한다. [평가 방법과 실제 발견한 오류](../evals/public-complaints/README.md).

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
