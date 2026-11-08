const fs=require('fs');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const file=process.argv[2]||'evals/results/coverage-v7-harness.json',r=read(file),prior=read('evals/results/coverage-v2-evidence.json'),initial=read('evals/results/final-evaluation.json'),samples=read('evals/complaints-40.json'),boundary=read('evals/results/coverage-dependencies-v7.json');
if(r.metrics?.cases!==40||r.metrics.errors||r.cases.some(c=>c.error)||r.boundaries.some(c=>c.error)||!r.finishedAt)throw Error('Complete all 40 cases before publishing');
const m=r.metrics,p=prior.metrics,oldFalse=prior.cases.flatMap(c=>c.compared.filter(x=>x.answerStatus!=='missing'&&x.answerFlagged).map(x=>c.id+':'+x.id)),newFalse=r.cases.flatMap(c=>c.compared.filter(x=>x.answerStatus!=='missing'&&x.answerFlagged).map(x=>c.id+':'+x.id)),oldMissing=prior.cases.flatMap(c=>c.afterGrade.checks.filter(x=>x.answerStatus==='missing').map(x=>c.id+':'+x.id)),newMissing=r.cases.flatMap(c=>c.afterGrade.checks.filter(x=>x.answerStatus==='missing').map(x=>c.id+':'+x.id));
const residual=r.cases.flatMap(c=>c.afterGrade.checks.filter(x=>x.answerStatus==='missing').map(x=>({caseId:c.id,id:x.id,text:samples.find(s=>s.id===c.id).expectedRequests.find(g=>g.id===x.id).text,reason:x.reason})));
const disagreements=r.cases.flatMap(c=>c.compared.filter(x=>(x.answerStatus==='missing')!==x.answerFlagged).map(x=>({caseId:c.id,id:x.id,text:samples.find(s=>s.id===c.id).expectedRequests.find(g=>g.id===x.id).text,reference:x.answerStatus,flag:x.answerFlagged,reason:x.reason,rules:c.detected.harness.decisions.filter(d=>x.matchedIds.includes(d.id)).map(d=>d.rule)})));
const summary={model:r.model,checkerVersion:r.checkerVersion,metrics:m,previousMetrics:p,oldMissingResolved:oldMissing.filter(x=>!newMissing.includes(x)),oldFalseAlertsResolved:oldFalse.filter(x=>!newFalse.includes(x)),newResidualOmissions:newMissing.filter(x=>!oldMissing.includes(x)),newFalseAlerts:newFalse.filter(x=>!oldFalse.includes(x)),disagreements,residual,additionalBoundaries:{passed:boundary.cases.filter(c=>c.pass).length,total:boundary.cases.length},usage:r.usage,source:file};
fs.writeFileSync('evals/results/coverage-harness-summary.json',JSON.stringify(summary,null,2)+'\n');
const table=`| 지표 · 요구사항 개수 | 직전 버전 | 규칙 하네스 |\n| --- | ---: | ---: |\n| 같은 답변의 누락 18개 중 탐지 | ${p.answerMissingDetected} | ${m.answerMissingDetected} |\n| 놓친 누락 | ${p.missed} | ${m.missed} |\n| 대응 있는 82개 중 오경보 | ${p.falseAlerts} | ${m.falseAlerts} |\n| 보완 후 답변의 누락 / 100개 요구 | ${p.afterAnswerMissing} | ${m.afterAnswerMissing} |`;
const cell=x=>String(x).replaceAll('|','／').replaceAll('\n',' ');
const report=`# 규칙 하네스 개선 재검증\n\n2026-11-08 · ${r.model} · 검사 버전 ${r.checkerVersion}. 합성 민원 40건·100개 요구. AI 작성 정답 후보와 동일 계열 자동 채점이며 독립 사람 검수는 미실시다.\n\n## 전후 비교\n\n${table}\n\n최초 버전의 오경보는 ${initial.metrics.answerFalseAlerts}개, 원래 답변의 누락은 18개였다. 이 문서는 직전 발표 수치인 오경보 8개·보완 후 누락 4개와 비교한다. 단위는 민원 건수가 아니라 요구사항이다.\n\n- 이전 누락 4개 중 이번 실행에서 해소: ${summary.oldMissingResolved.length}개 (${summary.oldMissingResolved.join(', ')||'없음'}).\n- 이전 오경보 8개 중 해소: ${summary.oldFalseAlertsResolved.length}개. 새로 발생한 오경보: ${summary.newFalseAlerts.length}개.\n- 이전에 남지 않았던 보완 후 누락: ${summary.newResidualOmissions.length}개. 원래 고정 답변 대비 새 누락 판정: ${m.newOmissions}개. 두 값은 비교 기준이 다르다.\n- 보완 시도 ${m.repairsAttempted}건, 채택 ${m.repairsAccepted}건. 보완 후 답변됨 ${m.afterStatuses.answered}, 사유 안내 ${m.afterStatuses.refused}, 필수 정보 질문 ${m.afterStatuses.clarification}, 누락 ${m.afterStatuses.missing}개.\n- 기존 경계 사례 ${m.boundaryPassed}/${m.boundaryCases}, 추가 질문 의존 관계 사례 ${summary.additionalBoundaries.passed}/${summary.additionalBoundaries.total}. 모두 개발용 합성 회귀 자료다.\n\n필수 질문과 구체적인 확답 불가 설명은 민원 해결이나 적법한 거절을 뜻하지 않는다. 보완 답변에는 근거 재검토가 필요한 문장 ${m.legalSentencesNeedingReview}개가 남아 있어 담당자 검토와 승인 조건을 유지한다.\n\n## 하네스 변경\n\n1. 원문만 입력한 별도 단계에서 요구 종류와 원문 인용으로 검사 계획을 고정한다. 답변을 읽은 모델이 요구의 의미를 바꾸지 못하도록 서버가 고정 계획을 적용한다.\n2. 답변 검사 모델은 구체 답변·한계 설명·질문·인용 근거를 추출한다. 최종 status는 출력 스키마에 없다.\n3. 코드 판정표가 정보 종류·질문 범위·기존 제공 정보·인용 일치를 확인한다. 공통 현장 질문으로 신규 조치·계획·연락 문의를 대체하지 못한다.\n4. 인용 기술 오류 재추출은 한 검사에서 최대 1회, 누락 보완도 한 초안에서 최대 1회다. 기존 문장을 보존하며 요구 대응이 퇴행한 보완안을 거부한다.\n5. 보완의 조문 ID를 제공된 목록으로 제한하고 서버가 표준 인용을 붙인다. 변경된 답변은 법령 근거도 다시 검사한다.\n6. 요구별 적용 규칙과 고정 계획은 harness.decisions, harness.plan, harness.observations에 저장한다. API 없이 같은 규칙을 재실행하는 evals/replay-coverage-rules.cjs를 제공한다.\n\n설계와 예외: [COVERAGE-HARNESS.md](COVERAGE-HARNESS.md). 규칙은 의미 해석을 완전히 대체하지 않는다. 요구 분류와 근거 추출이 틀리면 여전히 오경보 또는 누락이 생길 수 있다.\n\n## 실험 방법\n\n- 원문 40건, 기존 답변·조문, 기존 추출 요구, 기존 참조 판정을 그대로 사용했다. 정답과 평가 사례 ID는 제품 검사기·보완기에 보내지 않았다.\n- 직전 결과 일부를 재사용해 점수를 조합하지 않고 전체 40건을 새 API 호출로 검사했다. 보완된 답변만 변경하지 않은 참조 채점 프롬프트로 별도 채점했다. 보완하지 않은 답변은 고정 참조 판정을 사용했다.\n- 법령 수집·초안 생성부터 40건을 새로 실행한 것은 아니다. 검사와 제한된 보완 효과를 측정한다.\n- 원본 결과: [${file}](../${file}). 입력·코드 SHA-256과 실패 이력을 포함한다. API 호출 ${r.usage.calls}회, 입력 ${r.usage.inputTokens}토큰, 출력 ${r.usage.outputTokens}토큰.\n- 중간 v3는 전체 실행에서 누락 탐지가 나빠져 채택하지 않았다. v4는 요구 분류가 답변 문맥에 따라 바뀌는 문제로 중단했고, v5는 한계 설명에 완전한 직접 답변 조건을 잘못 요구하는 규칙을 발견해 중단했다. v6는 40건을 시도했으나 참조 인용 검증 오류 2건으로 38건만 완결됐고, 오경보가 16개로 증가해 채택하지 않았다. v7에서는 문장 일부 발췌의 질문 판정, 요구 종류 구분, 개별 업무 식별 조건을 수정했다. 중간 기록을 모두 보존하며 부분 실행을 40건 결과라고 표현하지 않는다.\n- 평가 과정의 전송·채점 기술 오류 재시도는 완료한 검사·보완 단계를 보존하고 실패한 단계만 재개한다. 유리한 답을 얻기 위해 완료 사례를 반복하지 않는다. C21 참조 채점의 비연속 문장 인용은 각 문장이 원문에 같은 순서로 정확히 존재할 때 그 사이 원문까지 포함한 연속 구간으로 복원했다. 판정·채점 기준은 변경하지 않았고 원래 판정과 복원 이력을 referenceEvidenceRepair에 보존했다. 없는 문장·의역·순서가 바뀐 인용은 복원하지 않는다.\n\n## 남은 판정 불일치\n\n${disagreements.length?'| 사례/요구 | 요구 | 고정 참조 | 하네스 누락 경고 | 참조 이유 |\n| --- | --- | --- | --- | --- |\n'+disagreements.map(x=>'| '+[x.caseId+'/'+x.id,x.text,x.reference,x.flag?'있음':'없음',x.reason].map(cell).join(' | ')+' |').join('\n'):'이번 실행의 이진 누락 판정은 고정 참조와 일치했다. 참조 판정 자체의 정확성이나 다른 데이터의 성능을 보장하지 않는다.'}\n\n## 보완 후 남은 누락\n\n${residual.length?'| 사례/요구 | 요구 | 별도 채점 이유 |\n| --- | --- | --- |\n'+residual.map(x=>'| '+[x.caseId+'/'+x.id,x.text,x.reason].map(cell).join(' | ')+' |').join('\n'):'이번 고정 개발셋의 자동 채점에서는 남은 누락이 없었다. 독립적인 사람 검수와 새 입력 검증은 여전히 필요하다.'}\n\n## 재현\n\n\`\`\`powershell\n$env:COVERAGE_EVAL_OUT='evals/results/coverage-harness-rerun.json'\nnode --env-file=.env.local evals/run-coverage-v2.cjs\n$env:COVERAGE_DEPENDENCY_OUT='evals/results/coverage-dependencies-rerun.json'\nnode --env-file=.env.local evals/run-coverage-dependencies.cjs\n\`\`\`\n\n새 실행은 유료 API 호출을 발생시킨다. 같은 결과 경로는 입력·코드 해시가 같을 때 실패 단계의 재개에만 사용한다. 사람 검수 기록은 [HUMAN-REVIEW.md](../evals/HUMAN-REVIEW.md)에 별도로 남긴다.\n`;
fs.writeFileSync('docs/COVERAGE-HARNESS-RESULTS.md',report);
const snippet=`<!-- coverage-evaluation:start -->\n### 규칙 하네스 실측 (2026-11-08)\n\n합성 민원 40건·100개 요구의 고정 입력으로 전체 재평가했습니다.\n\n${table}\n\n필수 정보 질문과 구체적인 확답 불가 사유도 대응 있음에 포함하므로 민원 해결률이 아닙니다. **AI 작성 정답 후보·동일 계열 자동 채점·개발셋 재평가이며, 독립적인 사람 검수는 아직 없습니다.**\n\n- 기존 경계 ${m.boundaryPassed}/${m.boundaryCases}, 추가 질문 관계 ${summary.additionalBoundaries.passed}/${summary.additionalBoundaries.total}.\n- [하네스 구조와 고정 규칙](docs/COVERAGE-HARNESS.md)\n- [실험 조건·전체 결과·남은 오류](docs/COVERAGE-HARNESS-RESULTS.md)\n- [원본 실행 JSON](${file}) · [직전 검증 기록](docs/COVERAGE-RESULTS.md)\n<!-- coverage-evaluation:end -->`;
const readme=fs.readFileSync('README.md','utf8');fs.writeFileSync('README.md',readme.replace(/<!-- coverage-evaluation:start -->[\s\S]*?<!-- coverage-evaluation:end -->/,snippet));console.log(JSON.stringify(summary));
fs.writeFileSync('docs/PRESENTATION-VERIFICATION.md',`# 발표용 검증 파트 · 7장

33팀 MIND · 2026-11-08. 기존 검증 발표자료를 갱신한 내용이다. 최종 제출용 전체 발표 PDF·영상과 구분한다.

## 1. 민원쉴드 — 요구 누락을 검사하는 규칙 하네스

공격적 표현을 가리면서 정당한 요구를 보존한다. 합성 민원 40건·100개 요구의 고정 답변으로 요구별 검사와 제한된 보완 효과를 측정했다.

## 2. 원문 계획 → 근거 추출 → 규칙 판정

원문만 보는 별도 호출에서 요구 종류와 원문 인용을 확정한다. 답변 검사와 보완 후 재검사에도 동일한 계획을 사용한다. 모델은 최종 status 대신 근거를 추출하고, 코드가 문장 ID·원문 인용·질문 범위·정보 종류·기존 제공 정보를 검사한다. 의미 추출의 오류까지 규칙으로 완전히 막는 것은 아니다.

인용 기술 오류는 최대 한 번 재추출하고, 누락 보완도 초안당 한 번으로 제한한다. 원래 문장을 유지하며 기존 대응이 퇴행한 보완을 거부한다. 답변이 바뀌면 법령 근거도 다시 검사한다.

## 3. 비교 조건

기존 답변·추출 요구·검색 조문·참조 판정을 고정했다. 제품 검사기와 보완기에 정답이나 평가 사례 ID를 보내지 않았다. 전체 40건을 새 API 호출로 검사하고, 보완한 답변은 기존 채점 지시문으로 별도 채점했다. 법령 검색·초안 생성부터 다시 실행한 실험은 아니다.

정답 후보는 AI 작성이며 동일 계열 모델로 채점했다. 개선에 사용한 개발 평가셋으로, 독립 사람 검수와 미사용 자료 검증은 남아 있다.

## 4. 결과

${table}

단위는 민원 건수가 아닌 요구사항이다. 사유 안내와 필수 정보 질문도 대응 있음에 포함하므로 민원 해결률이 아니다. 보완 후 답변됨 ${m.afterStatuses.answered}, 사유 안내 ${m.afterStatuses.refused}, 필수 질문 ${m.afterStatuses.clarification}, 누락 ${m.afterStatuses.missing}개다.

코드 회귀 테스트 109개 통과. 기존 경계 ${m.boundaryPassed}/${m.boundaryCases}, 추가 의존 관계 ${summary.additionalBoundaries.passed}/${summary.additionalBoundaries.total}. 자동 테스트 수는 AI 정확도와 구분한다.

## 5. 문장 일부 발췌로 생긴 경고 수정

합성 회귀 테스트의 실제 답변은 “점검을 위해 정류장 번호를 알려 주세요.”이고, 인용은 “정류장 번호”다. 인용이 정확히 해당 문장에 존재하는지 확인한 다음 그 문장 전체에서 요청 표현을 확인한다. “정류장 번호는 별도로 관리됩니다.”에는 요청이 없어 질문으로 인정하지 않는다. 두 조건을 코드 테스트로 고정했다.

## 6. 남은 오류와 한계

- 보완 후 누락 ${m.afterAnswerMissing}개, 고정 참조 대비 오경보 ${m.falseAlerts}개, 놓친 누락 ${m.missed}개.
- 직전 누락 4개 중 ${summary.oldMissingResolved.length}개, 직전 오경보 8개 중 ${summary.oldFalseAlertsResolved.length}개가 해소됐고, 새 오경보 ${summary.newFalseAlerts.length}개가 발생했다.
- 보완한 답변의 전체 문장 중 ${m.legalSentencesNeedingReview}개는 법령 근거 재검토가 필요하다.
- 분류·근거 추출·참조 판정이 모두 틀릴 수 있다. 개별 불일치는 [전체 결과](COVERAGE-HARNESS-RESULTS.md)에 공개한다.

## 7. 재현과 다음 검증

입력·코드 SHA-256, 실제 API 사용량, 중간 실패 버전, 요구별 적용 규칙과 관찰값을 보존했다. 저장된 관찰값을 같은 코드에 통과시키는 [규칙 재실행 스크립트](../evals/replay-coverage-rules.cjs)는 API나 정답 없이 규칙 판정의 재현성을 검사한다. 이는 의미 정확성 검증을 대신하지 않는다.

- [최종 실행 JSON](../${file})
- [하네스 구조와 규칙](COVERAGE-HARNESS.md)
- [전체 결과와 남은 오류](COVERAGE-HARNESS-RESULTS.md)
- [사람 검수 양식](../evals/HUMAN-REVIEW.md)

발표 문장: “AI가 근거를 추출하고, 코드가 요구별 대응을 확인하며, 담당자가 근거와 답변을 검토합니다.”
`);
