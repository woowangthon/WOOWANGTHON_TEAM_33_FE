# CLOVA Speech · Gemini 통화 비교

2026-11-15 사용자가 통화 지연 개선을 위해 CLOVA Speech와 Gemini 연결·비교를 지시했다. 기존 OpenAI 전용 정책의 예외는 이 로컬 통화 실험에만 적용한다. 운영 웹 민원 분석의 공급자를 바꾸거나 운영 중계를 재시작하지 않는다.

## 실제 구성

- 실시간 음성: CLOVA Speech 스트리밍 Basic 도메인 `minwon-shield-stream`.
- 문맥 판정·업무 사실 추출·역할 검증: `gemini-3.5-flash-lite`, thinking=`minimal`, stateless Interactions API(`store:false`). 모델·호출 간격은 비공개 설정으로 관리하며 고정된 사례 정답은 넣지 않는다.
- 음성 입력은 기존 웹 통화와 같은 8kHz G.711 μ-law를 디코딩하여 CLOVA가 요구하는 16kHz mono PCM16으로 보낸다. 원본보다 음질이 좋아지는 변환은 아니다.
- CLOVA가 반환하는 `position`으로 전사문을 구성하고, 모든 새 문장을 공통 `LiveSafety`에 보낸다. 단어 목록으로 시작하거나 최종 차단을 결정하지 않는다. Gemini에도 기존과 같은 발화자·대상·문맥·원문 발췌 검사를 적용한다.
- 완료 음성은 별도 CLOVA gRPC 연결에서 다시 인식한다. 공식 파일→gRPC 예제의 방식이며 **장문 인식 upload API 사용이 아니다**. 실시간·재인식이 같은 엔진이므로 독립 인식이 완전히 독립된 모델 판단을 뜻하지 않는다.
- 장문 Basic 도메인은 필수 Object Storage 경로가 없어 생성하지 않았다. 추가 저장소·번역·화자 구분·이벤트 탐지 기능을 신청하지 않았다. 장문 upload용 어댑터는 준비했으나 실제 API 검증 전이다.

## 인증과 실행

키는 Git에서 제외된 `.env.phone-comparison.local`에만 둔다. 브라우저 키 세부정보, 환경파일, Invoke URL 원문을 로그·Git·보고서에 넣지 않는다. 실제 음원과 원문·결과는 저장소 밖 `../phone-licensed-check/`에 보관한다.

```powershell
node --env-file=.env.local --env-file=.env.phone-comparison.local scripts/compare-phone-providers.mjs --check-config
node --env-file=.env.local --env-file=.env.phone-comparison.local scripts/compare-phone-providers.mjs --live --baseline
```

두 번째 명령은 유료 API를 호출한다. 기관이 정리한 실제 민원과 MIT 댓글의 수정 없는 Windows TTS 재연 음원을 사용하며 실제 시민 녹음·하드웨어 마이크 테스트와 구분한다. `--text-only`는 STT를 제외한 Gemini 판정·정제만 확인한다. `--sample=attack|normal|thirdparty`로 한 표본을 지정할 수 있다. 실패 시 다른 공급자로 조용히 바꾸거나 원문을 운영 민원으로 등록하지 않는다.

### Gemini Live 직접 음성 실험

```powershell
node --env-file=.env.phone-comparison.local scripts/compare-phone-providers.mjs --live --gemini-live
```

`gemini-3.8-live`에 PCM16 오디오를 WebSocket으로 계속 보내며, `report_safety` 함수 호출로 문맥 판정을 받는다. 모델 ID는 `PHONE_GEMINI_LIVE_MODEL`로 바꿀 수 있다. AI 생성 음성은 폐기하고 사람 통화에 보내지 않는다. 입력 전사를 별도로 수신하여 공격 발췌가 실제 전사에 있을 때만 양성 판정을 전달한다. 입력 전사보다 먼저 온 함수 호출은 대기하고, 취소·중복 호출과 연결 종료 뒤 결과는 실행하지 않는다. 자체 함수 인자에 든 인용문을 근거 검증용 전사로 재사용하지 않는다.

서버 VAD(무음 200ms)를 사용한다. 지속 연결이 발화 도중 즉시 함수 호출을 보장하는 것은 아니다. 이는 로컬 비교용 구현이며 운영 중계의 공급자 선택이나 자동 차단 경로에는 연결하지 않았다. 장시간 세션 복구·모든 발화의 확정 경계·브라우저 실제 마이크 통합까지 검증한 운영 기능으로 표시하지 않는다.

## 현재 검증 범위

로컬 gRPC 서버로 실제 직렬화·인증 메타데이터·오디오 형식·전사 위치·최종 seqId·연결 종료와 실패 처리를 검증했다. Gemini 요청 스키마·취소·미완료 응답·원문 근거·피해 신고 보존도 검사한다. 이 오프라인 검사가 외부 API의 품질·속도·가용성을 증명하지 않는다.

기존 Gemini 계정의 키로 실제 Interactions 호출에 성공했다. 공격 전용 MIT 댓글 1건에서 직접 공격을 판정했고, 업무 사실은 빈 배열이었다. 판정 단일 요청은 1,135ms, 사실 추출은 989ms였다. 전체 음성 차단 속도가 아니며 평균이나 SLA로 표시하지 않는다. 전체 실제 음원 비교 결과는 실행 파일별로 보관한다.

2026-11-15 실제 API 시험 기록:

| 방식 | 일반 민원 | 담당자 직접 공격 | 제3자 비하 댓글 |
| --- | --- | --- | --- |
| CLOVA gRPC + Gemini Flash-Lite | 자동 차단 없음, 분당·소음·방음벽 설치 보존 | 판정 8,175ms, 업무 사실 빈 배열 | **오탐: 5,323ms에 직접 공격으로 판정** |
| Gemini Live 직접 음성 | 자동 차단 없음 | 판정 8,451ms | 자동 차단 없음 |

판정 시간은 **음원 재생 시작부터 로컬 보호 콜백까지**이며 욕설 시작부터의 시간이 아니다. 직접 공격 음원 길이는 8,205ms다. Live 입력 전사 첫 수신은 7,907ms였으며, CLOVA 첫 수신은 1,683ms였다. 이번 Live 결과는 발화가 거의 끝난 시점에 나왔으므로 Live가 더 빠르다고 결론 내릴 수 없다. 한 표본씩의 결과이며 통계적 성능 수치, 실제 전화 녹음, 브라우저 양측 통화의 최종 음소거 지연으로 해석하지 않는다. 제3자 댓글은 피해자의 보호 요청 시험과도 구분한다.

CLOVA 종료 결과 누락은 마지막 오디오 직후 gRPC 요청 스트림을 닫던 구현에서 발생했다. 마지막 `epFlag=true, seqId=1` 결과가 올 때까지 연결을 유지하도록 수정한 뒤 실제 일반·공격 음원의 전사, 별도 세션 재인식, 요약에 성공했다. 응답이 없거나 연결이 먼저 끝나면 부분 전사를 확정 결과로 대체하지 않고 오류로 남긴다. 비교 중 Gemini REST 429가 한 번 발생했으며 운영용량 확보까지 증명한 것은 아니다.

429가 발생한 제3자 표본을 나중에 한 번 다시 실행했을 때, CLOVA는 실시간 전사와 완료 음원 재인식 모두 문장 시작의 제3자 지칭을 누락했다. Gemini는 남은 욕설을 직접 공격으로 판정했고 부분·최종 판정 모두 오탐했다. 정확한 발췌 일치만으로 발화 대상의 정확성을 보장할 수 없다는 실패 사례다. 표본 이름이나 정답을 판정 함수에 전달해 결과를 바꾸지 않았다. 이 조합은 운영 적용을 보류하며, 전사 누락·대상 불명확성을 별도 검증하기 전까지 보호 정확성 개선으로 주장하지 않는다.

원본 실행 기록(키·음원 원문은 비공개 작업 폴더): CLOVA 일반·공격 `provider-comparison-1794677412471.json`, 제3자 재시도 `provider-comparison-1794677477634.json`, Gemini Live 공격 `provider-comparison-1794677356144.json`, 일반·제3자 `provider-comparison-1794677452220.json`.

통화 회귀 검사 66개와 TypeScript 검사를 통과했다. 이 검사는 외부 서비스의 응답시간 보장이나 실제 마이크 검증을 대신하지 않는다.

공식 요금표의 한국 KRW 기준 스트리밍 Basic은 15초당 5원, 장문 Basic 음성 인식도 15초당 5원이며 VAT 별도·15초 올림이다. 스트리밍을 새 세션으로 재인식하면 두 번째 인식도 과금된다. 애플리케이션 통합 금액 상한은 추가하지 않는다.

## 후속 조사: 중간 전사·대상 근거·재생 대기

대화형 `gemini-3.8-live`의 함수 응답을 기다리는 경로와 실시간 전사 전용 `gemini-3.5-transcribe-live`를 구분해야 한다. Google 공식 문서는 전사 전용 모델의 `interimInputTranscription`이 발화 중 갱신되는 가설이고 `inputTranscription`이 확정 전사라고 설명한다. 이전 직접 음성 실험은 전자 경로를 비교하지 않았다. 기존 OpenAI `gpt-live-transcribe`도 이미 중간 델타를 지원하므로 모든 문제를 모델 교체로 설명하지 않는다.

후속 연구 스크립트는 운영 저장소 밖 `../phone-licensed-check/live-interim-experiment.mjs`에 있다. 일반·공격·제3자 입력의 정답이나 분류 라벨은 모델에 보내지 않는다. 공급자 연결과 중간 결과·정정 동작을 관찰하며, 운영 릴레이에는 연결하지 않는다. 원본 TTS WAV를 16kHz PCM으로 리샘플링했다. 현재 브라우저의 8kHz G.711 μ-law 축소 후 업샘플링 경로와 다르므로 모델 효과와 오디오 대역폭 효과가 분리된 비교가 아니다. 실제 사람 마이크와도 구분한다.

최초 연구 실행 `live-interim-1794677874415.json`에서 공격 음원 첫 중간 전사는 626ms, 첫 양성 판정은 6,406ms였다. 기존 대화형 경로의 8,451ms보다 빨랐지만 제3자 입력은 2,616ms에 오탐했다. 제3자 검사 후반에는 분류 API 오류 5회도 있었다. 이 실행의 모든 정상·제3자 판정이 끝까지 성공했다고 표시하지 않는다.

실패 분석에서 발견한 점:

- 중간 가설의 제3자 지칭이 오인식됐다가 다음 갱신에서 정정됐다.
- 기존 `LiveSafety`는 요청 때의 전사와 근거를 검사하며, 새 가설에서 근거가 정정돼 사라졌어도 돌아온 과거 양성 판정을 전달할 수 있다.
- 원문 발췌 일치가 대상 판정 정확성을 보장하지 않는다. 공급자 STT를 바꾸거나 프롬프트에 '문맥을 보라'고 쓰는 것만으로 해결됐다고 볼 수 없다.

개선 연구에서는 동일한 구조화 요청에 `attackTarget`과 `targetEvidence`를 추가했다. 담당자가 대상이라는 원문 근거가 없으면 차단을 확정하지 않는다. 양성 결과가 돌아왔을 때 공격 발췌와 대상 발췌가 최신 가설에도 있는지 다시 검사한다. 이후 추가된 인용 문맥까지 미래에 미리 알 수 있는 방식은 아니며, 완전한 의미 정확성을 보장하지 않는다.

대상 검사 연구 `live-interim-1794678043797.json`에서 제3자 입력 첫 중간 전사는 1,159ms였고, 확인한 5회 분류는 양성이 아니었으며 API 오류가 없었다. 전사 전용 세션은 대화형 `turnComplete`를 반드시 보내는 것이 아니므로, 이 연구는 입력 종료 후 최소 3초의 관찰 창과 확정 전사를 기록한다. 모든 오디오 샘플이 서버에서 처리됐다는 별도 종료 확인을 받았다고 표시하지 않는다. 초기 대상 검사 실행 `live-interim-1794677979918.json`은 `turnComplete`를 잘못 기다려 관찰 종료 타임아웃이 났으며, 성공 실행으로 다시 이름 붙이지 않았다.

같은 대상 검사 설정으로 일반·공격을 실행한 `live-interim-1794678130722.json`에서는 일반 민원 첫 중간 전사 1,126ms·양성 없음(분류 4회), 공격 첫 중간 전사 655ms·양성 6,231ms(분류 9회)였다. 두 입력의 분류 API 오류는 없었다. 앞의 제3자 연구와 합쳐 세 표본을 확인했지만, 정확도·평균·p95나 실제 마이크에서 같은 지연을 보장하는 수치로 일반화하지 않는다. 새 재생 버퍼는 아직 구현·검증하지 않았으므로 6,231ms는 담당자 청취 전에 차단했다는 뜻이 아니다.

음성 전달 구조도 바꿔야 한다. 현재 `FilterRelay.fromCaller`는 분석에 복사한 직후 원음을 담당자에게 전달한다. 따라서 인식과 분류가 아무리 빨라도 이미 들린 공격 음성을 되돌릴 수 없다. 제안은 민원인→담당자 방향에 재생 대기 버퍼를 두고, 분석을 먼저 진행한 뒤 전달·차단하는 방식이다. CleanStream 공개 구현과 방송용 지연 장비도 이 시간 분리 원리를 사용한다. 해당 구현의 단어 목록이나 탐지 정확성을 채택하는 뜻은 아니다. 1~2초는 충분함이 입증된 값이 아니며, 대표 음성에서 공격 시작·중간 전사·판정·실제 재생 시점을 측정하여 지연과 노출을 함께 평가해야 한다.

## 공식 출처

- [CLOVA gRPC API](https://api.ncloud-docs.com/docs/ai-application-service-clovaspeech-grpc)
- [CLOVA 파일→gRPC 예제](https://api.ncloud-docs.com/docs/ai-application-service-clovaspeech-example02)
- [CLOVA 요금](https://www.ncloud.com/product/aiService/clovaSpeech#pricing)
- [Gemini 3.5 Flash-Lite](https://aistudio.google.com/docs/models/gemini-3.5-flash-lite)
- [Gemini 구조화 출력](https://aistudio.google.com/docs/structured-output)
- [Gemini Live WebSocket](https://aistudio.google.com/docs/live-api/get-started-websocket)
- [Gemini Live 함수 호출](https://aistudio.google.com/docs/live-api/tools)
- [Gemini Live VAD](https://aistudio.google.com/docs/live-api/capabilities#configure-automatic-vad)
- [Gemini 3.8 Live 모델](https://aistudio.google.com/docs/models/gemini-3.8-live)
- [Gemini 실시간 전사 전용 모델·중간 전사](https://aistudio.google.com/docs/live-api/live-transcribe)
- [OpenAI 실시간 전사](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [CleanStream 공개 오디오 처리 구현](https://github.com/locaal-ai/obs-cleanstream/blob/main/README.md)
- [방송용 지연 장비의 처리 원리](https://docs.telosalliance.com/docs/program-delay-manager-ii)
