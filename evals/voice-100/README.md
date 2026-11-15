# 음성민원 평가 데이터 100개

민원 요약과 직원 대상 욕설 감지를 빠르게 시험하는 한국어 합성 데이터입니다.
**일반 민원 50개, 욕설 없는 강한 항의 25개, 직원 대상 욕설 25개**로 구성했습니다.
욕설 피해 신고·제3자 욕설 인용 사례는 포함하지 않았습니다.

## 바로 사용하기

1. `evaluation.xlsx` 또는 `data/evaluation.csv`를 엽니다.
2. `text` 원문만 요약·욕설 판정 시스템에 입력합니다. 정답이나 유형을 모델 입력에 섞지 않습니다.
3. 실제 요약과 욕설·직원 공격 판정을 입력합니다. 요약은 필수 내용 보존과 없는 사실 추가 여부를 사람이 확인합니다.
4. 음성 시험은 같은 ID의 `audio/MV-001.wav` 등을 사용합니다.

| 파일 | 용도 |
|---|---|
| `evaluation.xlsx` | 사람이 읽고 실제 결과를 적는 평가표 |
| `data/evaluation.csv` | 엑셀·스크립트용 평가표, UTF-8 BOM |
| `data/dataset.jsonl` | 한 줄에 한 건인 자동 시험용 원문·기준 |
| `data/dataset.json` | 같은 데이터의 JSON 배열 |
| `audio/` | ID별 WAV 100개, 16kHz·16bit·모노 PCM |
| `data/audio_manifest.json` | 음성 엔진·설정·파일 SHA-256 |
| `data/validation.json` | 구조·근거·WAV 무결성 검사 결과 |

## 판정 기준

- `reference_summary`: 요약 예시입니다. 문구가 완전히 같아야 한다는 뜻은 아닙니다.
- `must_preserve`: 의미를 보존해야 하는 원문 근거입니다. 숫자의 표기 변환은 허용합니다.
- `has_profanity`: 욕설이 포함되었는지입니다.
- `direct_attack`: 현재 응대하는 직원에게 직접 욕설을 했는지입니다.
- `expected_protect`: 해당 발화에 보호 처리가 필요한지입니다. 발화 전체를 무조건 지워야 한다는 뜻은 아닙니다.
- `summary_should_be_empty`: 욕설만 있고 민원 사실·요청이 없는 3개 항목은 빈 요약·빈 사실 목록이 정답입니다.
- `profanity_spans`: 원문 기준 0부터 시작하는 문자 구간이며 끝 위치는 포함하지 않습니다. 음성 시간 구간은 아닙니다.
- 날짜·시간·위치·금액이 없으면 임의로 채우지 않습니다. 발화자가 정정한 수치·요일은 마지막 정정 내용을 사용합니다.
- 질문·추측을 확정 사실로 바꾸지 않습니다. 예: 비상벨이 안 되는 것 같음 → 고장 확정으로 요약하지 않음.

이 버전에서는 욕설 사례를 모두 직원 직접 공격으로 구성했으므로 `has_profanity`와 `direct_attack`의 정답이 같습니다. 두 판정이 다른 상황은 이 데이터의 평가 범위 밖입니다.

## 데이터 성격

- 대본과 요약 기준은 이번 작업에서 새로 작성한 **AI 작성 가상 사례**입니다. 실제 민원·통화·개인정보를 가져오지 않았습니다.
- 20개 분야·상황 묶음에서 100개의 서로 다른 발화를 작성했습니다. 실존 사건이나 기관의 실제 처리 기록을 뜻하지 않습니다.
- 정답은 독립된 사람의 검수를 마친 골드 라벨이 아닙니다. `annotation_status`에 이를 기록했습니다.
- 음성은 Windows `Microsoft Heami Desktop` 한 목소리, 보통 속도로 합성했습니다. 실제 사람의 분노·고함·방언·잡음·동시 발화를 재현하지 않습니다.
- `text`는 TTS 입력 대본입니다. 실제 소리를 전수 청취해 만든 전사문은 아니며 `human_audio_reviewed`는 false입니다.
- 데이터 파일·음성 형식과 무음 여부·해시를 검사했습니다. 앱의 정확도와 실제 통화 차단 성능을 검증했다는 뜻은 아닙니다.

실제 앱 결과 칸은 비워 두었습니다. 이 저장소에는 아직 앱의 정확도나 성공률 측정값이 없습니다.
추후 학습·개발·평가용으로 나누려면 같은 `scenario_id`의 자료를 같은 쪽에 두세요.

## 재생성 및 검사

Node.js로 원문 메타데이터를 다시 생성합니다.

```sh
node scripts/build_dataset.mjs
```

Windows PowerShell 5.1과 설치된 한국어 Heami 음성으로 WAV를 생성합니다.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/generate_audio.ps1
```

Python 3 표준 라이브러리만으로 구조와 WAV를 검사합니다.

```sh
python scripts/validate_dataset.py
```

음성 생성 방식: [Microsoft SpeechSynthesizer.SetOutputToWaveFile 문서](https://learn.microsoft.com/en-us/dotnet/api/system.speech.synthesis.speechsynthesizer.setoutputtowavefile?view=netframework-4.8.1)
