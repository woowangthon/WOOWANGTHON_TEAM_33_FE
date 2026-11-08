// Live model regression for a false positive observed during production UI testing.
// Synthetic statements only. Does not change the frozen 40-case evaluation.
const fs=require('fs'),assert=require('node:assert/strict'),load=require('./loader.cjs')();
const {credentials}=load('lib/server.ts'),{verifyDraft}=load('lib/review.ts');
(async()=>{
 const keys=await credentials('office:cheongju:public');
 const expected=['not_legal','not_legal','needs_review','needs_review','needs_review'];
 const draft=['쓰레기 수거 요청을 확인했습니다.','수거 가능한 시점은 현장 위치와 폐기물 종류를 확인하기 전에는 확정하기 어렵습니다.','쓰레기 수거를 완료했습니다.','내일 오전 9시에 방문하겠습니다.','폐기물을 버리면 과태료 100만 원을 부과합니다.'].join('\n');
 const result=await verifyDraft(keys.openai,keys.model,'openai',draft,[]);
 const actual=result.sentences.map(s=>s.status);
 fs.writeFileSync('evals/results/review-regression.json',JSON.stringify({synthetic:true,model:keys.model,checkedAt:new Date().toISOString(),expected,actual,result},null,2));
 assert.deepEqual(actual,expected);console.log('Live acknowledgement/completion/deadline/legal-claim regression: 5/5 passed');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
