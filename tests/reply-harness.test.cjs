const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
class AppError extends Error{constructor(message,status,retryable=true){super(message);this.status=status;this.retryable=retryable;}}
function harness(reply){const cache=new Map();function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const out={};cache.set(file,out);new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name==='./server'?{AppError}:name==='./structured-ai'?{structuredAI:reply}:name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name),out);return out;}return load('lib/reply-harness.ts');}
const requests=[{id:'R1',kind:'requested_action',source:'body',quote:'소음을 측정',value:'소음 측정',requestIntent:'action',conditions:[]},{id:'R2',kind:'requested_action',source:'body',quote:'법적 기준',value:'법적 기준 안내',requestIntent:'rule_basis',conditions:[]}];
const c={title:'소음 확인',body:'소음을 측정하고 법적 기준을 알려주세요.',location:'',occurred_at:''};
const draft='소음 측정을 위해 발생 시간과 위치를 알려주세요.\n\n적용할 법적 기준은 발생원 종류를 확인해야 안내할 수 있습니다.';
const review={paragraphs:[{id:'P1',text:draft.split('\n\n')[0],requestIds:['R1'],supported:true,attackFree:true,reason:''},{id:'P2',text:draft.split('\n\n')[1],requestIds:['R2'],supported:true,attackFree:true,reason:''}],responses:requests.map((r,i)=>({requestId:r.id,paragraphIds:['P'+(i+1)],kind:i?'reason':'needs_information',intentPreserved:true,conditionsPreserved:true,reason:''}))};
const analysis={draft,sensitiveQuotes:[],summaryHarness:{status:'verified',sourceRequests:requests,facts:requests}};
test('every fixed request must be answered in actual paragraphs, with consistent IDs and meaning',()=>{
 const h=harness();assert.deepEqual(h.replyIssues(draft,requests,review),[]);
 for(const mutate of [r=>r.responses.pop(),r=>r.responses[1].kind='missing',r=>r.responses[1].conditionsPreserved=false,r=>r.paragraphs[1].text='검사자가 바꾼 문장',r=>r.paragraphs[1].requestIds=['R999'],r=>r.responses[1].paragraphIds=['P1'],r=>r.paragraphs[0].supported=false]){const r=structuredClone(review);mutate(r);assert.ok(h.replyIssues(draft,requests,r).length);}
});
test('reply validation uses original request IDs and only certifies the exact draft and context',async()=>{
 const calls=[],h=harness(async(...args)=>{calls.push(args);return review;});const result=await h.verifyReply({openai:'test',model:'test'},c,analysis,[]);
 assert.deepEqual(calls[0][3].sourceRequests,requests);assert.equal(result.audit.status,'verified');
 const checked={...analysis,draft:result.draft,replyHarness:result.audit};assert.equal(h.replyIsVerified(c,checked,[]),true);assert.equal(h.replyIsVerified(c,{...checked,draft:draft+'수정'},[]),false);assert.equal(h.replyIsVerified({...c,body:'다른 요청'},checked,[]),false);
});
test('a missing response is repaired once, then reviewed again; permanent omissions stay failed',async()=>{
 const missing=structuredClone(review);missing.responses[1].kind='missing';let calls=0;const progress=[];
 const h=harness(async(_keys,name)=>{calls++;return name==='reply_request_repair'?{draft}:calls===1?missing:review;});
 const result=await h.verifyReply({openai:'test',model:'test'},c,analysis,[],{onProgress:async p=>progress.push(structuredClone(p))});assert.equal(calls,3);assert.equal(result.audit.attempts.length,2);assert.ok(progress.some(p=>p.phase==='repairing'&&p.repairsUsed===1));
 let repairs=0;const fail=harness(async(_keys,name)=>{if(name==='reply_request_repair'){repairs++;return {draft};}return missing;});
 await assert.rejects(fail.verifyReply({openai:'test',model:'test'},c,analysis,[]),e=>e.retryable===false);assert.equal(repairs,1);
});
test('unknown repair outcome cannot silently make a second paid repair',async()=>{
 let saved;const missing=structuredClone(review);missing.responses[1].kind='missing';let calls=0;
 const h=harness(async(_keys,name)=>{calls++;if(name==='reply_request_repair')throw new Error('network');return missing;});
 await assert.rejects(h.verifyReply({openai:'test',model:'test'},c,analysis,[],{onProgress:async p=>saved=structuredClone(p)}));assert.equal(saved.phase,'repairing');
 await assert.rejects(h.verifyReply({openai:'test',model:'test'},c,analysis,[],{progress:saved}),e=>e.retryable===false);assert.equal(calls,2);
});

test('a repaired reply refreshes its actual citation list',async()=>{
 const cite={id:'law:1',title:'예시법',article:'제1조'},fixed=draft+'【예시법 제1조】';
 const bad=structuredClone(review);bad.responses[1].kind='missing';
 const good=structuredClone(review);good.paragraphs[1].text+='【예시법 제1조】';let checks=0;
 const h=harness(async(_keys,name)=>name==='reply_request_repair'?{draft:fixed}:++checks===1?bad:good);
 const result=await h.verifyReply({openai:'test',model:'test'},c,analysis,[cite]);
 assert.deepEqual(result.citationIds,['law:1']);assert.deepEqual(result.citations,[cite]);
});
