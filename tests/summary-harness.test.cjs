const fs=require('node:fs'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../evals/loader.cjs')()('lib/harness-policy.ts');
function harness(answer){
 const calls=[],out={};
 const stubs={'./structured-ai':{structuredAI:async(_keys,name,_instructions,input)=>{calls.push({name,input});const value=answer(name,input,calls.length);return name==='business_summary_repair'&&value&&!('facts' in value)?{...value,facts:input.facts}:value;}},'./harness-policy':policy};
 new Function('require','exports',ts.transpileModule(fs.readFileSync('lib/summary-harness.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name in stubs?stubs[name]:require(name),out);
 return {...out,calls};
}
const keys={provider:'openai',model:'synthetic-model'},source={title:'합성 피해 신고',body:'이웃이 저를 협박했습니다. 보호조치를 요청합니다.',location:'가상 장소',occurred_at:'2026-11-01'};
const factInput=[{kind:'reported_harm',source:'body',quote:'이웃이 저를 협박했습니다',value:'이웃으로부터 협박 피해를 입었다고 신고함',essential:true},{kind:'protection_request',source:'body',quote:'보호조치를 요청합니다',value:'보호조치 요청',essential:false}];
const good='이웃의 협박 피해를 신고하고 보호조치를 요청합니다.';
const review=(text=good,ids=['F1','F2'],extra={})=>({sentences:[{text,factIds:ids,supported:true,attackFree:true,reason:''}],missingFactIds:[],omittedBusinessFacts:[],factErrors:[],...extra});
test('facts require exact evidence in the declared source; source content determines IDs',()=>{
 const h=harness(()=>assert.fail());assert.equal(h.groundFacts(factInput,source)[1].id,'F2');
 assert.throws(()=>h.groundFacts([{...factInput[0],quote:'없는 원문'}],source),/exact source evidence/);
 assert.throws(()=>h.groundFacts([{...factInput[0],source:'title'}],source),/exact source evidence/);
});
test('verified reports preserve harm and protection even when the protection fact is not marked essential',async()=>{
 const h=harness(()=>review()),facts=h.groundFacts(factInput,source),out=await h.verifyBusinessSummary(keys,source,facts,good);
 assert.equal(out.summary,good);assert.equal(out.audit.status,'verified');assert.equal(out.audit.sourceHash,h.sourceHash(source));assert.equal(out.audit.attempts.length,1);assert.equal(h.calls.length,1);
});
test('code catches omitted protection despite a positive reviewer and repairs exactly once',async()=>{
 const bad='이웃의 협박 피해를 신고했습니다.';
 const h=harness((name,_input,count)=>name==='business_summary_repair'?{summary:good}:count===1?review(bad,['F1']):review());
 const out=await h.verifyBusinessSummary(keys,source,h.groundFacts(factInput,source),bad);
 assert.equal(out.summary,good);assert.deepEqual(h.calls.map(c=>c.name),['business_summary_review','business_summary_repair','business_summary_review']);
 assert.match(out.audit.attempts[0].issues.join(' '),/보호 요청/);
});
test('invented IDs, altered review text, false semantic judgments and source omissions fail validation',()=>{
 const h=harness(()=>assert.fail()),facts=h.groundFacts(factInput,source);
 for(const r of [review(good,['invented']),review('다른 문장'),review(good,['F1','F2'],{omittedBusinessFacts:['원문 업무 내용 누락']}),review(good,['F1','F2'],{factErrors:[{factId:'F1',reason:'원문은 단정하지 않음'}]})])assert.ok(h.summaryIssues(good,facts,r).length);
 for(const field of ['supported','attackFree']){const r=review();r.sentences[0][field]=false;assert.ok(h.summaryIssues(good,facts,r).length);}
});
test('continued failure stops after one repair and never substitutes a title',async()=>{
 const bad='처리가 완료되었습니다.';
 const h=harness(name=>name==='business_summary_repair'?{summary:bad}:review(bad,['F1'],{missingFactIds:['F2']}));
 await assert.rejects(h.verifyBusinessSummary(keys,source,h.groundFacts(factInput,source),bad),e=>e.retryable===false&&e.audit.attempts.length===2);
 assert.equal(h.calls.filter(c=>c.name==='business_summary_repair').length,1);
 const empty=harness(()=>assert.fail('No paid request for missing business facts'));
 await assert.rejects(empty.verifyBusinessSummary(keys,source,[],''),e=>e.retryable===false);
});
test('invalid extracted meaning is never accepted after an unsuccessful repair',async()=>{
 const h=harness(name=>name==='business_summary_repair'?{summary:good}:review(good,['F1','F2'],{factErrors:[{factId:'F1',reason:'근거 없는 확정'}]}));
 await assert.rejects(h.verifyBusinessSummary(keys,source,h.groundFacts(factInput,source),good),e=>e.retryable===false);assert.equal(h.calls.length,3);
});
test('an interrupted paid repair is checkpointed and never repeated by a workflow retry',async()=>{
 let progress;
 const h=harness(name=>{if(name==='business_summary_repair')throw Error('Network outcome unknown');return review('피해 신고입니다.',['F1']);});
 const facts=h.groundFacts(factInput,source);
 await assert.rejects(h.verifyBusinessSummary(keys,source,facts,'피해 신고입니다.',{onProgress:async value=>{progress=structuredClone(value);}}),/Network outcome unknown/);
 assert.equal(progress.phase,'repairing');assert.equal(progress.repairsUsed,1);
 const resumed=harness(()=>assert.fail('Paid repair must not repeat'));
 await assert.rejects(resumed.verifyBusinessSummary(keys,source,facts,'피해 신고입니다.',{progress}),e=>e.retryable===false);assert.equal(resumed.calls.length,0);
});
test('changed source and stale checkpoints cannot reuse summary verification',async()=>{
 const h=harness(()=>assert.fail());
 await assert.rejects(h.verifyBusinessSummary(keys,{...source,title:'변경된 제목'},h.groundFacts(factInput,source),good,{progress:{version:2,sourceHash:h.sourceHash(source),summary:good,repairsUsed:0,phase:'reviewing',attempts:[]}}),/stale/);
});
