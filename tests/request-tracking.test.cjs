const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),ts=require('typescript');
const load=require('../evals/loader.cjs')(),tracking=load('lib/request-tracking.ts'),coverage=load('lib/coverage.ts');
const cases=JSON.parse(fs.readFileSync('evals/request-tracking-12.json','utf8')).cases;
for(const s of cases)test(`${s.id}: corrections retain IDs/history, one-request reply reopens only its request, answers cannot complete work`,()=>{
 const c={title:s.title,body:s.body,supplements:[],analysis:{summary:s.requests.join(' '),requests:s.requests,sensitiveQuotes:[]}};
 let initial=tracking.seedTracking(c);assert.equal(tracking.trackingCounts(initial).completed,0);
 let completed=tracking.updateProgress(initial,'Q1','completed','가상 평가: 담당자가 현장 처리 결과를 기록했습니다.','2026-11-08T01:00:00Z');
 assert.throws(()=>tracking.updateProgress(initial,'Q1','completed','','now'));
 const rows=completed.items.map(r=>({id:r.id,text:r.id==='Q2'?s.edited:r.text,withdrawn:r.id==='Q3'}));rows.push({text:s.added,withdrawn:false});
 const confirmed=tracking.confirmRequests(completed,rows,'2026-11-08T02:00:00Z');
 assert.equal(confirmed.items[0].state,'completed','unrelated completed work is retained');assert.equal(confirmed.items[1].id,'Q2');assert.equal(confirmed.items[1].originalText,s.requests[1]);assert.equal(confirmed.items[1].state,'received');assert.equal(confirmed.items[2].withdrawn,true);assert.equal(confirmed.items.length,4);
 assert.throws(()=>tracking.confirmRequests(confirmed,rows.slice(1),'now'),'silent deletion rejected');
 const waiting=tracking.updateProgress(confirmed,'Q2','waiting','해당 요청의 대상 식별 정보를 알려 주세요.','2026-11-08T03:00:00Z');
 const replied=tracking.replyToRequest(waiting,'Q2','가상 대상 번호는 N-12입니다.','2026-11-08T04:00:00Z');
 assert.equal(replied.items[1].state,'received');assert.equal(replied.items[0].state,'completed');assert.equal(tracking.trackingCounts(replied).pending,2);assert.equal(c.body,s.body);
 assert.throws(()=>tracking.updateProgress(replied,'Q3','completed','이미 철회된 요청입니다.','now'));
 assert.deepEqual(tracking.seedTracking({...c,request_tracking:replied,analysis:{requests:['다시 분석된 문장']}}),replied,'AI rerun cannot overwrite progress or citizen wording');
 assert.notEqual(coverage.sourceSnapshot(c),coverage.sourceSnapshot({...c,request_tracking:confirmed}));
 assert.equal(coverage.sourceSnapshot({...c,request_tracking:confirmed}),coverage.sourceSnapshot({...c,request_tracking:replied}),'progress alone does not change semantic review source');
});
test('confirmed requirements cannot vanish, merge or receive fabricated quote evidence from a model',async()=>{
 const s=cases[0],c={title:s.title,body:s.body,supplements:[],analysis:{summary:'일정 문의',requests:[],sensitiveQuotes:[]}};c.request_tracking=tracking.confirmRequests(tracking.seedTracking({...c,analysis:{requests:s.requests}}),s.requests.map((text,i)=>({id:'Q'+(i+1),text,withdrawn:false})),'now');
 const stub={'./structured-ai':{structuredAI:async()=>({requirements:[{source:'request:Q1',quote:'존재하지 않는 인용',summaryStatus:'preserved',summaryReason:'오류'}]})},'./server':{AppError:class extends Error{}},'./review':{},'./coverage':coverage,'./coverage-harness':{}};const e={};new Function('require','exports',ts.transpileModule(fs.readFileSync('lib/coverage-ai.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>stub[n],e);
 const audit=await e.auditRequirements({},c);assert.deepEqual(audit.requirements.map(r=>r.id),['Q1','Q2','Q3']);assert.ok(audit.requirements.every(r=>r.summaryStatus==='missing'));assert.equal(audit.requirements[0].quote,s.requests[0]);
 c.request_tracking.items.forEach(r=>r.withdrawn=true);const empty=await e.auditRequirements({},c);assert.equal(empty.requirements.length,0);assert.match(empty.noRequestReason,/철회/);
});
