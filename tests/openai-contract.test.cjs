const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
class AppError extends Error{constructor(message,status){super(message);this.status=status;}}
const modules=new Map();
function load(file){file=path.resolve(file);if(modules.has(file))return modules.get(file);const exports={};modules.set(file,exports);
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',js)(name=>name==='./server'?{AppError,now:()=>new Date().toISOString()}:name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name),exports);return exports;
}
const {generateAnalysis}=load('lib/ai.ts');
const complaint={title:'씨발 쓰레기 처리',body:'현장 확인을 요청합니다.',location:'청주시 가상길',category:'생활폐기물',occurred_at:'2026-10-01'};
const citation={id:'law:test:제14조',title:'가상 근거',article:'제14조',text:'검증용 가상 조문'};
const valid={safeTitle:'생활쓰레기 현장 확인 요청',expressionFindings:[{kind:'profanity',source:'title',quote:'씨발',reason:'모델이 판단한 공격 표현'}],summary:'현장 확인 요청',requests:['현장 확인'],questions:[],shieldLevel:'normal',shieldReason:'',sensitiveQuotes:[],actions:[],draft:'현장 확인을 검토하겠습니다. [law:test:제14조]',citationIds:[citation.id]};
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

test('OpenAI refuses incomplete, refused and invalid responses without storing an analysis',async()=>{
 try {
  for(const data of [
   {status:'incomplete',output:[]},
   {status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]},
   {status:'completed',output:[{type:'message',content:[{type:'output_text',text:'not JSON'}]}]},
  ]){global.fetch=async()=>Response.json(data);await assert.rejects(invoke(),e=>e.status===502);}
 } finally {global.fetch=realFetch;}
});

test('exhausted OpenAI credits differ from rate limits and never retry or fall back to Gemini',async()=>{
 try {
  let calls=0;
  global.fetch=async()=>{calls++;return Response.json({error:{code:'credit_balance_exhausted',type:'insufficient_quota'}},{status:429});};
  await assert.rejects(invoke(),e=>e.status===503&&/잔액/.test(e.message));assert.equal(calls,1);
  global.fetch=async()=>Response.json({error:{code:'rate_limit_exceeded'}},{status:429});await assert.rejects(invoke(),e=>e.status===429);
 } finally {global.fetch=realFetch;}
});
