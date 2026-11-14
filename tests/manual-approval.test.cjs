const fs=require('node:fs'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}}
function harness(overrides={}){
 const c={id:'test',owner:'guest:test',revision:3,status:'reviewing',auto_state:'completed',draft:'',published:'',tasks:[],draft_review:null,coverage_review:null,...overrides},writes=[];
 const route={},stubs={
  'zod':require('zod'),'next/server':{},'../../user':{getCurrentUser:async()=>({userId:'guest:test',isStaff:true,isGuest:true})},
  '../../../lib/server':{AppError,now:()=> 'now',decodeComplaint:()=>c,eventStatement:()=>({run:async()=>{}}),database:()=>({prepare:sql=>({bind:(...values)=>({first:async()=>c,run:async()=>{writes.push({sql,values});return {meta:{changes:1}};}})})})},
  '../../../lib/access':{officeForOwner:()=> 'office:test',officeScope:()=> '1=1',publicStaffInbox:()=>true},'../../../lib/types':{categories:['기타'],statuses:{reviewing:'검토 중'}},'../../../lib/citations':{inlineReferences:()=>({ids:[]})}
 };
 new Function('require','exports',ts.transpileModule(fs.readFileSync('app/api/[...path]/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>{
  if(/\/(review|coverage-ai|coverage|request-tracking|request-tracking-store)$/.test(n))throw Error('Retired dependency: '+n);
  return stubs[n]||{};
 },route);
 return {writes,call:async(action='approve',input={},path='')=>{
  const p='complaints/test'+path,method=path?'POST':'PATCH';
  return route[method](new Request('https://test.invalid/api/'+p,{method,headers:{Origin:'https://test.invalid','Content-Type':'application/json'},body:JSON.stringify({revision:3,action,draft:'담당자가 확인한 합성 민원 답변입니다.',reviewed:true,...input})}),{params:Promise.resolve({path:p.split('/')})});
 }};
}
test('staff can publish a manually confirmed draft without automatic review records',async()=>{
 process.env.SITE_MODE='staff';const h=harness(),r=await h.call();assert.equal(r.status,200);assert.equal(h.writes[0].values[0],'resolved');assert.equal(h.writes[0].values[2],'담당자가 확인한 합성 민원 답변입니다.');
});
test('manual approval retains confirmation, revision, active-analysis and completed-record guards',async()=>{
 process.env.SITE_MODE='staff';
 for(const [row,input,status] of [[{},{reviewed:false},400],[{},{draft:'짧음'},400],[{},{revision:2},409],[{auto_state:'processing'},{},409],[{status:'resolved'},{},409]]){
  const h=harness(row);assert.equal((await h.call('approve',input)).status,status);assert.equal(h.writes.length,0);
 }
});
test('citizens cannot approve and retired endpoints do not write or call AI',async()=>{
 process.env.SITE_MODE='citizen';assert.equal((await harness().call()).status,403);
 process.env.SITE_MODE='staff';const h=harness();for(const p of ['/requirements','/verify-draft','/coverage-decision'])assert.equal((await h.call('unused',{},p)).status,410);assert.equal(h.writes.length,0);
});
