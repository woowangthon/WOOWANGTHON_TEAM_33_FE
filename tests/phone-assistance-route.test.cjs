const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const input={callId:'synthetic',revision:'1',segments:[{turnId:'1',text:'가상공원 쓰레기 수거 요청',facts:[{kind:'request',value:'쓰레기 수거'}]}]};
function fixture({staff=true,docs=[],key='service-key',failDocs=false,failGemini=false}={}){
 const calls={owners:[],generated:[]},exports={};
 class AppError extends Error {constructor(message,status){super(message);this.status=status;}}
 const source=ts.transpileModule(fs.readFileSync('app/api/phone/assistance/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const lib=require('./helpers/loader.cjs')()('lib/phone-assistance.ts');
 const mocks={
 '../../../user':{getCurrentUser:async()=>staff?{userId:'test-staff',isStaff:true}:null},
 '../../../../lib/access':{officeForOwner:id=>'office:'+id},
 '../../../../lib/server':{AppError,rateLimit:async()=>{},credentials:async owner=>{calls.owners.push(owner);return {openai:key,model:'test-model'};},database:()=>({prepare:()=>({bind:owner=>{calls.owners.push(owner);return {all:async()=>{if(failDocs)throw Error('unavailable');return {results:docs};}};}})})},
 '../../../../lib/laws':{retrieve:d=>({citations:d,warnings:[]})},
 '../../../../lib/phone-assistance':{assistanceInput:lib.assistanceInput,assistanceTranscript:lib.assistanceTranscript,AssistanceProviderError:lib.AssistanceProviderError,generateAssistance:async(input,citations,config)=>{calls.generated.push({input,citations,config});if(failGemini&&config.provider==='gemini')throw new lib.AssistanceProviderError(429);return {...input,model:config.model,items:[],citations,warnings:[]};}}
 };
 new Function('require','exports',source)(name=>mocks[name],exports);
 return {calls,post:(body=input,origin='https://staff.test')=>exports.POST(new Request('https://staff.test/api/phone/assistance',{method:'POST',headers:{origin},body:typeof body==='string'?body:JSON.stringify(body)}))};
}
test('assistance route enforces staff authentication, same origin and input bounds before inference',async()=>{
 const old=process.env.SITE_MODE;process.env.SITE_MODE='staff';
 try{assert.equal((await fixture().post(input,'https://outside.test')).status,403);assert.equal((await fixture({staff:false}).post()).status,401);assert.equal((await fixture().post('{')).status,400);assert.equal((await fixture().post({})).status,400);assert.equal((await fixture().post('x'.repeat(60001))).status,413);}finally{if(old===undefined)delete process.env.SITE_MODE;else process.env.SITE_MODE=old;}
});
test('a Gemini limit falls back once to the service OpenAI model and skips the limited provider during cooldown',async()=>{
 const names=['SITE_MODE','PHONE_ASSIST_PROVIDER','SERVICE_GEMINI_API_KEY'];const old=Object.fromEntries(names.map(n=>[n,process.env[n]]));Object.assign(process.env,{SITE_MODE:'staff',PHONE_ASSIST_PROVIDER:'gemini',SERVICE_GEMINI_API_KEY:'gemini-service-test'});
 try{const f=fixture({failGemini:true});assert.equal((await f.post()).status,200);assert.equal((await f.post()).status,200);assert.deepEqual(f.calls.generated.map(c=>c.config.provider),['gemini','openai','openai']);assert.equal(f.calls.generated.at(-1).config.key,'service-key');}finally{for(const n of names){if(old[n]===undefined)delete process.env[n];else process.env[n]=old[n];}}
});
test('only the scoped service key and official HTTPS sources reach inference; failed retrieval is explicit',async()=>{
 const names=['SITE_MODE','PHONE_ASSIST_PROVIDER','SERVICE_GEMINI_API_KEY','GEMINI_API_KEY'];const old=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 Object.assign(process.env,{SITE_MODE:'staff',PHONE_ASSIST_PROVIDER:'openai',GEMINI_API_KEY:'personal-must-not-use'});delete process.env.SERVICE_GEMINI_API_KEY;
 try{
  const f=fixture({docs:[{id:'ok',sourceUrl:'https://www.law.go.kr/law',text:'근거'},{id:'bad',sourceUrl:'https://law.go.kr.attacker.test/',text:'허위'},{id:'http',sourceUrl:'http://law.go.kr',text:'허위'}]});const response=await f.post();assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.deepEqual(f.calls.owners,['office:test-staff','office:test-staff']);assert.deepEqual(f.calls.generated[0].citations.map(c=>c.id),['ok']);assert.equal(f.calls.generated[0].config.key,'service-key');
  const down=await fixture({failDocs:true}).post();assert.equal(down.status,200);assert.match((await down.json()).warnings.join(' '),/근거 없이/);
  process.env.PHONE_ASSIST_PROVIDER='gemini';assert.equal((await fixture().post()).status,503);
 }finally{for(const n of names){if(old[n]===undefined)delete process.env[n];else process.env[n]=old[n];}}
});
