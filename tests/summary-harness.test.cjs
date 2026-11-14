const fs=require('node:fs'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../evals/loader.cjs')()('lib/harness-policy.ts');
function harness(answer){
 const calls=[],out={};
 const stubs={'./structured-ai':{structuredAI:async(_keys,name,_instructions,input)=>{calls.push({name,input});const value=answer(name,input,calls.length);return name==='business_summary_repair'&&value?{...value,facts:value.facts??input.facts,requests:value.requests??input.requests}:value;}},'./harness-policy':policy};
 new Function('require','exports',ts.transpileModule(fs.readFileSync('lib/summary-harness.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name in stubs?stubs[name]:require(name),out);
 return {...out,calls,verifyBusinessSummary:(keys,c,facts,candidate,options={})=>out.verifyBusinessSummary(keys,c,facts,candidate,{requests:['보호조치를 요청합니다.'],...options})};
}
const keys={provider:'openai',model:'synthetic-model'},source={title:'합성 피해 신고',body:'이웃이 저를 협박했습니다. 보호조치를 요청합니다.',location:'가상 장소',occurred_at:'2026-11-01'};
const factInput=[{kind:'reported_harm',source:'body',quote:'이웃이 저를 협박했습니다',value:'이웃으로부터 협박 피해를 입었다고 신고함',essential:true},{kind:'protection_request',source:'body',quote:'보호조치를 요청합니다',value:'보호조치 요청',essential:false}];
const good='이웃의 협박 피해를 신고하고 보호조치를 요청합니다.';
const review=(text=good,ids=['F1','F2'],extra={})=>({sentences:[{text,factIds:ids,supported:true,attackFree:true,reason:''}],requests:[{index:0,text:'보호조치를 요청합니다.',factIds:['F2'],supported:true,attackFree:true,reason:''}],missingFactIds:[],omissions:[],factErrors:[],...extra});
test('facts require exact evidence in the declared source; source content determines IDs',()=>{
 const h=harness(()=>assert.fail());assert.equal(h.groundFacts(factInput,source)[1].id,'F2');
 assert.throws(()=>h.groundFacts([{...factInput[0],quote:'없는 원문'}],source),/exact source evidence/);
 assert.throws(()=>h.groundFacts([{...factInput[0],source:'title'}],source),/exact source evidence/);
});
test('verified reports preserve harm and protection even when the protection fact is not marked essential',async()=>{
 const h=harness(()=>review()),facts=h.groundFacts(factInput,source),out=await h.verifyBusinessSummary(keys,source,facts,good);
 assert.equal(out.summary,good);assert.equal(out.audit.status,'verified');assert.equal(out.audit.sourceHash,h.sourceHash(source));assert.equal(out.audit.attempts.length,1);assert.equal(h.calls.length,1);
});

test('a grounded summary longer than 220 characters and two sentences passes without a length-driven repair',async()=>{
 const sentences=[
  '가상 공원 동쪽 입구의 보도블록 여러 곳이 들떠 있어 유모차와 휠체어가 통행하기 어렵고 어두운 시간에는 걸려 넘어질 위험이 있으므로, 파손 구간 전체를 확인하고 보수 일정과 보행자를 위한 임시 안전조치를 안내해 달라고 요청합니다.',
  '서쪽 출입구의 조명은 사흘째 켜지지 않아 야간 보행이 어려운 상태라고 신고했으며, 주변 조명의 고장 여부도 함께 점검하고 수리 전까지 이용자가 안전하게 통행할 수 있는 경로와 현장 안내 방법을 확인해 달라고 요청합니다.',
  '공원 중앙의 배수구는 비가 온 뒤 물이 빠지지 않고 주변 산책로까지 고이는 상태라고 신고했으며, 배수구 막힘과 시설 상태를 점검하고 청소 또는 보수 등 필요한 조치와 확인 결과를 각각 안내해 달라고 요청합니다.',
 ];
 const summary=sentences.join(' '),c={...source,title:'가상 공원 시설 점검 요청',body:summary};
 const facts=sentences.map(quote=>({kind:'requested_action',source:'body',quote,value:quote,essential:true}));
 const h=harness(()=>review(summary,[],{sentences:sentences.map((text,i)=>({text,factIds:['F'+(i+1)],supported:true,attackFree:true,reason:'원문에 명시된 시설별 점검 요청'})),requests:sentences.map((text,index)=>({index,text,factIds:['F'+(index+1)],supported:true,attackFree:true,reason:''}))}));
 assert.ok(summary.length>220);assert.ok(sentences.length>2);
 const out=await h.verifyBusinessSummary(keys,c,h.groundFacts(facts,c),summary,{requests:sentences});
 assert.equal(out.summary,summary);assert.equal(out.audit.status,'verified');assert.equal(h.calls.length,1);
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
 for(const r of [review(good,['invented']),review('다른 문장'),review(good,['F1','F2'],{omissions:[{source:'body',quote:'보호조치를 요청합니다',role:'protection_request',reason:'업무 내용 누락'}]}),review(good,['F1','F2'],{factErrors:[{factId:'F1',reason:'원문은 단정하지 않음'}]})])assert.ok(h.summaryIssues(good,facts,r).length);
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
test('the bounded repair can recover a missed protection fact with new literal evidence',async()=>{
 const initial='이웃의 협박 피해를 신고합니다.';
 const h=harness((name,_input,count)=>name==='business_summary_repair'?{summary:good,facts:factInput}:count===1?review(initial,['F1'],{omissions:[{source:'body',quote:'보호조치를 요청합니다',role:'protection_request',reason:'보호조치 요청'}]}):review());
 const out=await h.verifyBusinessSummary(keys,source,h.groundFacts(factInput.slice(0,1),source),initial);
 assert.equal(out.audit.facts.length,2);assert.equal(out.audit.attempts[0].facts.length,1);assert.equal(out.audit.attempts[1].facts.length,2);assert.equal(out.summary,good);
});
test('new facts proposed by a repair must pass literal grounding before any completion',async()=>{
 const h=harness(name=>name==='business_summary_repair'?{summary:good,facts:[{...factInput[0],quote:'없는 인용'}]}:review(good,['F1']));
 await assert.rejects(h.verifyBusinessSummary(keys,source,h.groundFacts(factInput,source),good),/exact source evidence/);
 assert.equal(h.calls.filter(c=>c.name==='business_summary_repair').length,1);
});
test('an unsupported sentence with no fact IDs reaches repair instead of a validator retry loop',async()=>{
 const bad='이미 보호조치를 완료했습니다.';
 const h=harness((name,_input,count)=>name==='business_summary_repair'?{summary:good,facts:factInput}:count===1?review(bad,[],{sentences:[{text:bad,factIds:[],supported:false,attackFree:true,reason:'없는 처리 완료'}]}):review());
 const out=await h.verifyBusinessSummary(keys,source,h.groundFacts(factInput,source),bad);
 assert.equal(out.summary,good);assert.equal(h.calls.length,3);assert.equal(out.audit.attempts.length,2);
});
test('intentional exclusions cannot be turned into mandatory summary content',()=>{
 const h=harness(()=>assert.fail()),attack='담당자를 찾아가 해치겠다',c={...source,body:source.body+' '+attack},facts=h.groundFacts(factInput,c),r=review();
 r.omissions=[{source:'body',quote:attack,role:'direct_attack',reason:'의도적 제외'}];
 assert.deepEqual(h.summaryIssues(good,facts,r,c),[]);
 r.omissions[0].role='business';
 const findings=[{kind:'threat',scope:'direct_attack',source:'body',quote:attack,reason:'직접 공격'}];
 assert.deepEqual(h.summaryIssues(good,facts,r,c,findings),[]);
 r.omissions[0].role='reported_harm';assert.ok(h.summaryIssues(good,facts,r,c,findings).length,'reported harm is never silently excluded by an attack signal');
});
test('omission observations themselves require literal source evidence',()=>{
 const h=harness(()=>assert.fail()),r=review();r.omissions=[{source:'body',quote:'없는 발췌',role:'nonessential_context',reason:'자료 설명'}];
 assert.match(h.summaryIssues(good,h.groundFacts(factInput,source),r,source).join(' '),/발췌가 일치/);
});

test('all requests are preserved internally without repeating each one in the summary',async()=>{
 const summary='보도 파손으로 통행이 어렵습니다.',requests=['보도를 보수해 주세요.','보수 일정을 알려 주세요.'];
 const c={...source,body:[summary,...requests].join(' ')};
 const raw=[{kind:'problem',source:'body',quote:summary,value:summary,essential:true},...requests.map(quote=>({kind:'requested_action',source:'body',quote,value:quote,essential:true}))];
 const h=harness((name,input)=>name==='business_summary_repair'?{summary,facts:raw,requests}:review(summary,['F1'],{missingFactIds:['F2','F3'],requests:input.requests.map((text,index)=>({index,text,factIds:['F'+(index+2)],supported:true,attackFree:true,reason:''}))}));
 const out=await h.verifyBusinessSummary(keys,c,h.groundFacts(raw,c),summary,{requests:requests.slice(0,1)});
 assert.equal(out.summary,summary);assert.deepEqual(out.requests,requests);
 assert.match(out.audit.attempts[0].issues.join(' '),/요청이 내부 목록에서 빠졌/);assert.equal(h.calls.length,3);
 assert.deepEqual(out.audit.attempts[1].issues,[]);
});

test('request checks reject invented IDs, changed text, duplicate indices and unsupported connections',()=>{
 const h=harness(()=>assert.fail()),facts=h.groundFacts(factInput,source),requests=['보호조치를 요청합니다.'];
 const goodReview=review();assert.deepEqual(h.requestIssues(requests,facts,goodReview),[]);
 const cases=[{factIds:['unknown']},{factIds:['F1']},{text:'다른 요청'},{index:1},{supported:false},{attackFree:false},{factIds:[]}];
 for(const change of cases){const r=review();Object.assign(r.requests[0],change);assert.ok(h.requestIssues(requests,facts,r).length);}
 const duplicate=review();duplicate.requests.push({...duplicate.requests[0]});assert.ok(h.requestIssues(requests,facts,duplicate).length);
 assert.ok(h.requestIssues(requests,facts,{...review(),requests:[]}).length);
});
