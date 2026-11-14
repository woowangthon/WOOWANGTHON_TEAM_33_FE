const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
class AppError extends Error{constructor(message,status,retryable=true){super(message);this.status=status;this.retryable=retryable;}}
const modules=new Map();
function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',js)(name=>name==='./server'?{AppError,now:()=>new Date().toISOString()}:name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name),exports);return exports;
}
const {generateAnalysis}=load('lib/ai.ts');
const complaint={title:'씨발 쓰레기 처리',body:'현장 확인을 요청합니다.',location:'청주시 가상길',category:'생활폐기물',occurred_at:'2026-10-01'};
const citation={id:'law:test:제14조',title:'가상 근거',article:'제14조',text:'검증용 가상 조문'};
const valid={safeTitle:'생활쓰레기 현장 확인 요청',expressionFindings:[{kind:'profanity',scope:'direct_attack',source:'title',quote:'씨발',reason:'직접적인 공격 표현'}],summary:'현장 확인 요청',requests:['현장 확인'],questions:[],shieldLevel:'normal',shieldReason:'',sensitiveQuotes:[],actions:[],draft:'현장 확인을 검토하겠습니다. [law:test:제14조]',citationIds:[citation.id]};
const realFetch=global.fetch;
const invoke=()=>generateAnalysis('synthetic-openai-key','gpt-6-luna',complaint,[citation],[],'test','openai');
const result=value=>Response.json({status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]});

test('OpenAI uses strict Responses output and the shared grounded protection/citation validation',async()=>{
 try {
  global.fetch=async(url,init)=>{
   assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(init.headers.Authorization,'Bearer synthetic-openai-key');
   const body=JSON.parse(init.body);assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);assert.equal(body.reasoning.effort,'low');
   assert.equal(body.text.format.strict,true);assert.equal(body.text.format.schema.additionalProperties,false);assert.equal(body.text.format.schema.properties.expressionFindings.items.additionalProperties,false);
   assert.equal(JSON.parse(body.input).complaint.title,complaint.title);return result(valid);
  };
  const out=await invoke();assert.equal(out.model,'gpt-6-luna');assert.equal(out.shieldLevel,'caution');assert.equal(out.expressionFindings[0].source,'title');assert.equal(out.citations[0].id,citation.id);
  global.fetch=async()=>result({...valid,citationIds:['fabricated']});await assert.rejects(invoke(),/없는 근거/);
 } finally {global.fetch=realFetch;}
});

test('OpenAI receives extracted facts and prior validation through the shared generator',async()=>{
 const facts=[{id:'F1',kind:'requested_action',source:'body',quote:'현장 확인을 요청합니다.',value:'현장 확인 요청',essential:true}],seen=[],previousValidation=[{summary:'현장 확인',issues:['내부 요청 누락'],review:{requests:[]}}];
 try {
  global.fetch=async(url,init)=>{
   assert.equal(url,'https://api.openai.com/v1/responses');
   seen.push(JSON.parse(JSON.parse(init.body).input));return result(valid);
  };
  await generateAnalysis('synthetic-key','synthetic-model',complaint,[citation],[],'test','openai',facts,previousValidation);
  assert.equal(seen.length,1);assert.deepEqual(seen[0].groundedFacts,facts);assert.deepEqual(seen[0].previousValidation,previousValidation);
 }finally{global.fetch=realFetch;}
});

test('OpenAI refuses incomplete, refused and invalid responses without storing an analysis',async()=>{
 try {
  for(const data of [
   {status:'incomplete',output:[]},
   {status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]},
   {status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not JSON'}]}]},
  ]){global.fetch=async()=>Response.json(data);await assert.rejects(invoke(),e=>e.status===502);}
 } finally {global.fetch=realFetch;}
});

test('exhausted OpenAI credits differ from rate limits without retrying or using another provider',async()=>{
 try {
  let calls=0;
  global.fetch=async()=>{calls++;return Response.json({error:{code:'credit_balance_exhausted',type:'insufficient_quota'}},{status:429});};
  await assert.rejects(invoke(),e=>e.status===503&&/잔액/.test(e.message));assert.equal(calls,1);
  global.fetch=async()=>Response.json({error:{code:'rate_limit_exceeded'}},{status:429});await assert.rejects(invoke(),e=>e.status===429);
 } finally {global.fetch=realFetch;}
});

test('transient OpenAI failures retry once with the same request and timeout',async()=>{
 const calls=[];
 try {
  global.fetch=async(url,init)=>{calls.push({url,...init});return calls.length===1?new Response('',{status:503}):result(valid);};
  assert.equal((await invoke()).summary,valid.summary);assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].signal,calls[1].signal);
  assert.ok(calls.every(c=>c.url==='https://api.openai.com/v1/responses'));
 }finally{global.fetch=realFetch;}
});

test('invalid credentials and model access fail without provider substitution',async()=>{
 try {
  for(const status of [400,401,403,404]){
   let calls=0;global.fetch=async()=>{calls++;return Response.json({error:{}},{status});};
   await assert.rejects(invoke(),e=>e.status===503&&e.retryable===false);assert.equal(calls,1);
  }
  global.fetch=async()=>assert.fail('unsupported provider must fail before any request');
  assert.throws(()=>generateAnalysis('synthetic','test',complaint,[],[],'test','unsupported'),/OpenAI/);
 }finally{global.fetch=realFetch;}
});
