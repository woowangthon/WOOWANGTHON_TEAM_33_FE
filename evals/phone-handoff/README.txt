민원쉴드 수신 보호·정제 텍스트 검증 (2026-11-01, 한국 시간)

현재 요구와 범위
민원인의 음성을 분석하고 직접 욕설/위협이 확인되면 수신 보호 모드를 켠다.
보호 모드에서는 수신 원음을 담당자에게 보내지 않고 정제 텍스트와 요구사항을
전달한다. 담당자의 마이크는 계속 민원인에게 연결된다. AI 음성 응답은 없다.
이 코드는 독립된 로컬 WebSocket 실험이며 배포된 사이트의 전화 기능이 아니다.

활성 코드
- filter-relay.mjs: 원음 차단, 사람 송신 유지, 정제 텍스트 전용 전달,
  수동 원음 복귀, 종료 후 이벤트 및 오래된 수정본 차단
- text-pipeline.mjs: 별도 빠른 보호 판정, 원음 재전사, 요구사항/위치 정제
- native-review.mjs: 의심 발화의 원음 직접 분석. 텍스트만 출력, minimal
  reasoning, 15초 제한. 직접 욕설/위협 근거가 없는 차단 판정을 거부한다.
- audio.mjs: PCM/WAV, 저역 통과 필터, 8kHz G.711 mu-law 전화 음질 변환
- ../../scripts/verify-phone-text.mjs: 로컬 통신사/담당자 + 실제 OpenAI API 실험
- ../../scripts/verify-phone-handoff.mjs: 위 텍스트 실험의 호환 진입점

지연/인식 개선
실시간 전사에 의심 표현이 나오면 요약을 기다리지 않고 짧게 보호 판정을 한다.
밀린 부분 전사는 최신 내용으로 합치며 발화당 최대 3회만 빠른 판정을 호출한다.
발화 종료 시 원음을 별도 재전사하고 보호 검사와 정제문 생성을 병렬 실행한다.
미확정 의심 발화에는 원음 분석을 추가하며 명확한 욕설 인용 신고에는 생략한다.
추가 원음 분석은 더 느리며 모델의 재확인 자체도 틀릴 수 있다.
제발/업무 비판/제3자 욕설 인용을 구분한다. 차단은 실제 원문 발췌에 명시적인
욕설/위협이 있어야 한다. 분류만 실패하면 전사 내용은 보존하고 확인 상태를 표시한다.
추출 facts의 근거가 전사문에 실제로 있는지도 검사한다. 담당자 정제문은 facts로만
조합하고 별도의 자유로운 설명문을 덧붙이지 않는다. 알려진 욕설이 남으면 그 표현만
마스킹하고 정당한 요구/신고는 계속 전달한다. 이 검사는 의미 정확성이나
원음과의 일치를 보증하지 않는다. 새로운 욕설, 방언, 발음 변형은 놓칠 수 있다.

실행 (프로젝트 루트, Node 24)
node --test evals/phone-handoff/filter-relay.test.mjs evals/phone-handoff/text-pipeline.test.mjs
node --env-file=.env.local scripts/verify-phone-text.mjs
선택 실행 PowerShell: $env:SHIELD_LAB_CASES = 'profanity-windows,plea-control'
선택값 제거: Remove-Item Env:SHIELD_LAB_CASES
선택 가능: normal,criticism,profanity,quoted-report,profanity-windows,plea-control

단위 시험은 14개이며 API를 호출하지 않는다. 통합 검증은 기존 프로젝트 키로
실제 API를 호출하므로 과금된다. 키나 전체 외부 API 오류 본문은 출력하지 않는다.

입력 자료: 5개 시나리오의 합성 녹음 6개. 실제 민원 통화가 아니다.
클라우드 4개: outputs/phone-handoff-verification/cloud-input/*.wav
Windows 욕설: outputs/phone-audio-check/profanity.wav
제발 대조군: outputs/phone-text-verification/control/plea-control.wav
대조군 재생성: node evals/phone-handoff/generate-plea-control.mjs
speech.mjs/generate-cloud-fixtures.mjs는 시험 입력 생성 도구이다.
router.mjs/router.test.mjs는 이전 자동 음성 응답 설계이며 현재 흐름에는 쓰지 않는다.

결과
outputs/phone-text-verification/result.json (전체 사례)
outputs/phone-text-verification/result-selected.json (선택 재검증)
outputs/phone-text-verification/정제텍스트-개선검증보고서.txt
이전 result-text-only-v1.json, result-text-only-v2.json, result-text-only-v3.json,
result-selected-v4.json, result-selected-v5.json과
outputs/phone-filter-verification/ 음성 출력 실험은 실패를 포함한 비교 기록이다.

checks는 제한된 키워드 및 전달 상태 검사다. passed는 정확도나 속도 보증이 아니다.
protectedBeforeUtteranceEnd와 shieldAfterUtteranceEndMs도 함께 읽어야 한다.
차단 전 이미 전달한 첫 욕설은 되돌릴 수 없다. 어려운 발음에서는 요구가 보존되어도
보호 전환이 발화 종료보다 늦을 수 있다. 상세 보고서의 실패와 한계를 함께 읽는다.

미검증
실제 070/PSTN/SIP, 통신사 가입/과금, 공개 HTTPS/WSS, 브라우저 마이크/스피커,
에코 제거, 실제 발화/잡음/중첩/방언, 자동 발화 끝 감지(VAD), 장시간 다중 발화,
재연결, 모델 실패 시 화면 처리. 실험은 발화 종료를 알고 있으며 마이크도 합성
프레임으로 모사한다. 실제 전화 회선 연결 후 전 구간 검증이 별도로 필요하다.
