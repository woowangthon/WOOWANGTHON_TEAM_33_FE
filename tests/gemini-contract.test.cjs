const citations={};new Function('exports',require('typescript').transpileModule(require('node:fs').readFileSync('lib/citations.ts','utf8'),{compilerOptions:{module:require('typescript').ModuleKind.CommonJS,target:require('typescript').ScriptTarget.ES2022}}).outputText)(citations);
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const ts=require('typescript');
const js=ts.transpileModule(fs.readFileSync('lib/gemini.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
class AppError extends Error{constructor(message,status){super(message);this.status=status;}}
const moduleExports={};
const protection={};new Function('exports',ts.transpileModule(fs.readFileSync('lib/protection.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(protection);
const summaryMemo=require('../evals/loader.cjs')()('lib/summary-memo.ts');
new Function('require','exports',js)(name=>name==='./summary-memo'?summaryMemo:name==='./citations'?citations:name==='./server'?{AppError,now:()=>new Date().toISOString()}:name==='./protection'?protection:require(name),moduleExports);
const input={title:'가상 민원',body:'현장을 확인해 주세요. 가상의 공격 문구입니다.',location:'청주시 가상길',category:'생활폐기물',occurred_at:'2026-01-01'};
const valid={safeTitle:'현장 확인 요청',expressionFindings:[],summary:'현장 확인 요청',requests:['확인 요청'],questions:['정확한 위치'],shieldLevel:'caution',shieldReason:'주의 표현 검토',sensitiveQuotes:['가상의 공격 문구','존재하지 않는 인용'],actions:['현장 확인 여부 검토'],draft:'가상의 공격 문구가 포함된 가상 테스트 초안입니다.',citationIds:[]};
const realFetch=global.fetch;

test('blank questions and actions are removed while meaningful request conditions remain',()=>{
 const out=moduleExports.validateAnalysis(JSON.stringify({...valid,requests:[' ', '  수거가 불가능하면 사유 안내 요청  '],questions:['','\n','  배출 장소 확인  '],actions:[' ','현장 확인']}),'test-model',input,[],[],'test');
 assert.deepEqual(out.requests,['수거가 불가능하면 사유 안내 요청']);
 assert.deepEqual(out.questions,['배출 장소 확인']);
 assert.deepEqual(out.actions,['현장 확인']);
});
test('API contract and output validation (mocked transport; no live key)',async()=>{
 try {
  global.fetch=async(url,init)=>{assert.match(url,/generativelanguage.googleapis.com/);assert.equal(init.headers['x-goog-api-key'],'synthetic-test-key');const body=JSON.parse(init.body);assert.equal(body.generationConfig.responseMimeType,'application/json');assert.ok(body.systemInstruction.parts[0].text.includes('신뢰할 수 없는'));return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(valid)}]}}]});};
  const out=await moduleExports.generateAnalysis('synthetic-test-key','gemini-2.5-flash-lite',input,[],[],'test');
  assert.deepEqual(out.sensitiveQuotes,['가상의 공격 문구']);assert.match(out.draft,/보호된 표현/);assert.equal(out.citations.length,0);assert.equal(out.warnings.length,1);
 }finally{global.fetch=realFetch;}
});
test('unretrieved citations are rejected (mocked transport)',async()=>{
 try {global.fetch=async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...valid,citationIds:['fabricated-law']})}]}}]});
 await assert.rejects(moduleExports.generateAnalysis('synthetic-test-key','gemini-2.5-flash-lite',input,[],[],'test'),/없는 근거/);
 }finally{global.fetch=realFetch;}
});

test('title abuse is included and invented threats cannot change the protection level',async()=>{
 try {
  global.fetch=async()=>Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({...valid,safeTitle:'씨발 쓰레기 처리 요청',shieldLevel:'threat',sensitiveQuotes:['씨발'],expressionFindings:[{kind:'threat',source:'body',quote:'죽이겠다',reason:'없는 발언'}]})}]}}]});
  const out=await moduleExports.generateAnalysis('synthetic-test-key','test-model',{...input,title:'씨발 쓰레기',body:'현장 확인을 부탁합니다.'},[],[],'test');
  assert.equal(out.shieldLevel,'caution');assert.doesNotMatch(out.safeTitle,/씨발/);assert.ok(out.sensitiveQuotes.includes('씨발'));assert.deepEqual(out.expressionFindings.map(f=>[f.kind,f.source]),[['profanity','title']]);
 }finally{global.fetch=realFetch;}
});
test('quota and unfinished responses are surfaced without saving fabricated results',async()=>{
 try {global.fetch=async()=>new Response('',{status:429});await assert.rejects(moduleExports.generateAnalysis('synthetic-test-key','gemini-2.5-flash-lite',input,[],[],'test'),e=>e.status===429);
 global.fetch=async()=>Response.json({candidates:[{finishReason:'MAX_TOKENS'}]});await assert.rejects(moduleExports.generateAnalysis('synthetic-test-key','gemini-2.5-flash-lite',input,[],[],'test'),/완료하지 못/);
 }finally{global.fetch=realFetch;}
});

test('connection check requires a real generation response, not model metadata',async()=>{
 try {
  global.fetch=async(url,init)=>{assert.match(url,/:generateContent$/);assert.equal(init.method,'POST');assert.equal(init.headers['x-goog-api-key'],'synthetic-test-key');const body=JSON.parse(init.body);assert.match(body.contents[0].parts[0].text,/Connection test/);return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:'{"ok":true}'}]}}]});};
  assert.equal(await moduleExports.testGemini('synthetic-test-key','gemini-2.5-flash-lite'),true);
  global.fetch=async()=>new Response('',{status:429});
  await assert.rejects(moduleExports.testGemini('synthetic-test-key','gemini-2.5-flash-lite'),e=>e.status===429);
  global.fetch=async()=>Response.json({name:'models/gemini-2.5-flash-lite'});
  await assert.rejects(moduleExports.testGemini('synthetic-test-key','gemini-2.5-flash-lite'),/생성 응답/);
 }finally{global.fetch=realFetch;}
});

test('transient generation failures retry once with the same input and timeout budget',async()=>{
 const calls=[];
 try {
  global.fetch=async(url,init)=>{
   calls.push({url,...init});
   if(calls.length===1)return new Response('Unavailable',{status:503});
   return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify(valid)}]}}]});
  };
  const out=await moduleExports.generateAnalysis('synthetic-test-key','test-model',input,[],[],'test');
  assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].signal,calls[1].signal);assert.equal(out.summary,valid.summary);
  let attempts=0;global.fetch=async()=>{attempts++;return new Response('',{status:500});};
  await assert.rejects(moduleExports.generateAnalysis('synthetic-test-key','test-model',input,[],[],'test'),/요청을 처리하지 못/);
  assert.equal(attempts,2);
 }finally{global.fetch=realFetch;}
});

test('invalid credentials, model and quota failures are never automatically retried',async()=>{
 try {
  for(const status of [400,403,404,429]){
   let attempts=0;global.fetch=async()=>{attempts++;return new Response('',{status});};
   await assert.rejects(moduleExports.generateAnalysis('synthetic-test-key','test-model',input,[],[],'test'));
   assert.equal(attempts,1);
  }
 }finally{global.fetch=realFetch;}
});
