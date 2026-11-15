const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
const compile=file=>ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}}

test('browser requests cannot create, replace, or clear API credentials',async()=>{
 const previousMode=process.env.SITE_MODE;process.env.SITE_MODE='staff';
 let databaseTouched=false,scheduled=false;
 const route={};
 new Function('require','exports',compile('app/api/[...path]/route.ts'))(name=>{
  if(name==='zod')return require('zod');
  if(name==='next/server')return {after:()=>{scheduled=true;}};
  if(name==='../../user')return {getCurrentUser:async()=>({userId:'guest:synthetic',isStaff:true,isGuest:true})};
  if(name.endsWith('/server'))return {AppError,database:()=>{databaseTouched=true;throw new Error('unexpected DB access');}};
  if(name.endsWith('/types'))return {categories:['기타'],statuses:['received']};
  if(name.endsWith('/access'))return {officeForOwner:owner=>owner,publicStaffInbox:()=>false};
  if(name.endsWith('/request-tracking'))return require('./helpers/loader.cjs')()('lib/request-tracking.ts');
  if(name.endsWith('/request-tracking-store')||name.endsWith('/complaint-list'))return {};
  if(/\/(public-data|task-history|laws|samples|automatic|review|analysis-dispatch|supplements|citations|analysis-stages|semantic-search|coverage-ai|coverage|reports|report-core|protection)$/.test(name))return {};
  throw new Error(name);
 },route);
 try {
  for(const input of [{openai:'synthetic-new-key',law:'synthetic-new-oc'},{clearOpenai:true,clearLaw:true}]){
   const response=await route.POST(new Request('https://test.invalid/api/settings',{method:'POST',headers:{'Content-Type':'application/json',origin:'https://test.invalid'},body:JSON.stringify(input)}),{params:Promise.resolve({path:['settings']})});
   assert.equal(response.status,404);
  }
  assert.equal(databaseTouched,false);assert.equal(scheduled,false);
 } finally {if(previousMode===undefined)delete process.env.SITE_MODE;else process.env.SITE_MODE=previousMode;}
});

test('only explicit service credentials are shared with guest workspaces',async()=>{
 const names=['LAW_API_OC','SERVICE_LAW_API_OC','OPENAI_API_KEY','SERVICE_OPENAI_API_KEY','SERVICE_OPENAI_MODEL','SERVICE_AI_PROVIDER'];
 const previous=Object.fromEntries(names.map(name=>[name,process.env[name]]));
 const server={};
 new Function('require','exports',compile('lib/server.ts'))(name=>{
  if(name==='./citations')return {};
  if(name==='./request-tracking')return {};
  if(name==='./protection')return {protectedTitle:c=>c.title};
  if(name==='./database')return {database:()=>({prepare:()=>({bind:()=>({first:async()=>null})})})};
  throw new Error(name);
 },server);
 try {
  for(const name of names)delete process.env[name];
  process.env.OPENAI_API_KEY='private-legacy-key';process.env.LAW_API_OC='private-legacy-oc';
  assert.equal((await server.credentials('guest:test')).openai,'');
  assert.equal((await server.credentials('guest:test')).law,'');
  assert.equal((await server.credentials('office:cheongju:public')).law,'');
  assert.equal((await server.credentials('office:cheongju:public')).openai,'');
  process.env.SERVICE_OPENAI_API_KEY='managed-service-key';
  process.env.SERVICE_OPENAI_MODEL='synthetic-openai-model';
  const partial=await server.credentials('guest:test');
  assert.equal(partial.openai,'managed-service-key');assert.equal(partial.law,'');assert.equal(partial.model,'synthetic-openai-model');
  process.env.SERVICE_LAW_API_OC='managed-service-oc';
  const full=await server.credentials('guest:test');
  assert.equal(full.law,'managed-service-oc');assert.equal(full.openai,'managed-service-key');
  assert.deepEqual(full,await server.credentials('legacy-office'));
  process.env.SERVICE_AI_PROVIDER='unsupported-old-value';
  const fixed=await server.credentials('guest:test');assert.equal(fixed.provider,'openai');assert.equal(fixed.model,'synthetic-openai-model');
  delete process.env.SERVICE_OPENAI_API_KEY;
  const unavailable=await server.credentials('guest:test');assert.equal(unavailable.openai,'');assert.equal(unavailable.provider,'openai');
 } finally {for(const [name,value] of Object.entries(previous)){if(value===undefined)delete process.env[name];else process.env[name]=value;}}
});
