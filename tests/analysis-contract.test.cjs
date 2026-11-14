const {test}=require('node:test'),assert=require('node:assert/strict');
const contract=require('../evals/loader.cjs')()('lib/analysis-contract.ts');
const input={title:'가상 민원',body:'현장을 확인해 주세요. 가상의 공격 문구입니다.',location:'가상길',category:'생활폐기물',occurred_at:'2026-01-01'};
const valid={safeTitle:'현장 확인 요청',expressionFindings:[],summary:'현장 확인 요청',requests:['확인 요청'],questions:['정확한 위치'],shieldLevel:'caution',shieldReason:'주의 표현 검토',sensitiveQuotes:['가상의 공격 문구','존재하지 않는 인용'],actions:['현장 확인 여부 검토'],draft:'가상의 공격 문구가 포함된 가상 테스트 초안입니다.',citationIds:[]};
const validate=(value,c=input)=>contract.validateAnalysis(JSON.stringify(value),'synthetic-model',c,[],[],'test');
test('analysis validation preserves long summaries without an arbitrary character cap',()=>{
 const summary='서측 보행로의 조명 고장 구간을 점검하고 수리 일정과 임시 통행 안내를 확인해 주세요. '.repeat(100).trim();
 assert.ok(summary.length>3000);assert.equal(validate({...valid,summary}).summary,summary);
});
test('source protection and citation checks remain intact after removing the alternate provider',()=>{
 const out=validate(valid);assert.deepEqual(out.sensitiveQuotes,['가상의 공격 문구']);assert.match(out.draft,/보호된 표현/);assert.equal(out.citations.length,0);
 assert.throws(()=>validate({...valid,citationIds:['fabricated-law']}),/없는 근거/);
 assert.throws(()=>contract.validateAnalysis('{}','synthetic',input,[],[],'test'),/응답 형식/);
});
test('grounded title abuse is preserved while invented threats cannot change the protection level',()=>{
 const out=validate({...valid,safeTitle:'씨발 쓰레기 처리 요청',shieldLevel:'threat',sensitiveQuotes:['씨발'],expressionFindings:[{kind:'profanity',scope:'direct_attack',source:'title',quote:'씨발',reason:'직접적인 공격 표현'},{kind:'threat',source:'body',quote:'죽이겠다',reason:'없는 발언'}]},{...input,title:'씨발 쓰레기',body:'현장 확인을 부탁합니다.'});
 assert.equal(out.shieldLevel,'caution');assert.doesNotMatch(out.safeTitle,/씨발/);assert.deepEqual(out.expressionFindings.map(f=>[f.kind,f.source]),[['profanity','title']]);
});
test('third-party attack reports are masked without labelling the reporter as abusive',()=>{
 const quote='저에게 모욕적인 말을 했습니다',out=validate({...valid,sensitiveQuotes:[],expressionFindings:[{kind:'insult',scope:'reported_speech',source:'body',quote,reason:'제3자의 폭언 피해 신고'}]},{...input,body:quote+' 보호조치를 요청합니다.'});
 assert.equal(out.shieldLevel,'normal');assert.equal(out.expressionFindings[0].scope,'reported_speech');assert.ok(out.sensitiveQuotes.includes(quote));
});
