const fs=require('node:fs'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}}
function harness(overrides={}){
 const c={id:'test',owner:'guest:test',revision:3,status:'reviewing',auto_state:'completed',draft:'',published:'',tasks:[],draft_review:null,coverage_review:null,...overrides},writes=[];
 const route={},stubs={
  'zod':require('zod'),'next/server':{},'../../user':{getCurrentUser:async()=>({userId:'guest:test',isStaff:true,isGuest:true})},
  '../../../lib/server':{AppError,now:()=> 'now',decodeComplaint:()=>c,eventStatement:()=>({run:async()=>{}}),rateLimit:async()=>{},database:()=>({batch:async statements=>Promise.all(statements.map(s=>s.run())),prepare:sql=>({bind:(...values)=>({first:async()=>{if(sql.includes('SET tasks=')){writes.push({sql,values});return overrides.taskConflict?null:{revision:c.revision+1};}return c;},run:async()=>{writes.push({sql,values});return {meta:{changes:1}};}})})})},
  '../../../lib/task-history':require('../evals/loader.cjs')()('lib/task-history.ts'),
  '../../../lib/analysis-dispatch':{startAnalysis:async()=>{}},
  '../../../lib/access':{officeForOwner:()=> 'office:test',officeScope:()=> '1=1',publicStaffInbox:()=>true},'../../../lib/types':{categories:['기타'],statuses:{reviewing:'검토 중'}},'../../../lib/citations':{inlineReferences:()=>({ids:[]})}
 };
 new Function('require','exports',ts.transpileModule(fs.readFileSync('app/api/[...path]/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>{
  if(/\/(review|coverage-ai|coverage|request-tracking|request-tracking-store|supplements)$/.test(n))throw Error('Retired dependency: '+n);
  return stubs[n]||{};
 },route);
 const request=(p,method,input)=>route[method](new Request('https://test.invalid/api/'+p,{method,headers:{Origin:'https://test.invalid',...(input instanceof FormData?{}:{'Content-Type':'application/json'})},body:input instanceof FormData?input:JSON.stringify(input)}),{params:Promise.resolve({path:p.split('/')})});
 return {writes,request,call:async(action='approve',input={},path='')=>{
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
 process.env.SITE_MODE='staff';const h=harness();for(const p of ['/requirements','/verify-draft','/coverage-decision','/supplements'])assert.equal((await h.call('unused',{},p)).status,410);assert.equal(h.writes.length,0);
});

test('retired library and supplement actions cannot create records',async()=>{
 process.env.SITE_MODE='staff';const h=harness();
 for(const p of ['laws/search','laws/import'])assert.equal((await h.request(p,'POST',{})).status,410);
 assert.equal((await h.call('status',{status:'waiting'})).status,400);
 process.env.SITE_MODE='citizen';const form=new FormData();form.set('text','추가 답변');form.set('revision','3');
 assert.equal((await h.request('complaints/test/supplements','POST',form)).status,410);
 assert.equal((await h.request('laws/search','POST',{})).status,403);
 assert.equal(h.writes.length,0);
});
test('retiring staff manual intake preserves citizen and telephone intake',async()=>{
 const input={title:'가상 검증 민원',body:'이 민원은 자동 검증을 위한 합성 자료입니다.',category:'기타',location:'가상동',occurredAt:'2020-01-01',consent:true};
 process.env.SITE_MODE='staff';const h=harness();
 assert.equal((await h.request('complaints','POST',input)).status,410);assert.equal(h.writes.length,0);
 assert.equal((await h.request('complaints','POST',{...input,channel:'phone'})).status,201);assert.equal(h.writes[0].values.at(-1),'phone');
 process.env.SITE_MODE='citizen';const citizen=harness();
 assert.equal((await citizen.request('complaints','POST',input)).status,201);assert.equal(citizen.writes[0].values.at(-1),'web');
 assert.equal((await citizen.request('complaints','POST',{...input,channel:'phone'})).status,403);assert.equal(citizen.writes.length,1);
});
test('legacy waiting records remain reviewable with their original history preserved',()=>{
 const server={};new Function('require','exports',ts.transpileModule(fs.readFileSync('lib/server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>{
  if(n==='./protection')return {protectedTitle:c=>c.title};if(n==='./citations')return {readableCitations:text=>text};return {};
 },server);
 const history=[{id:'legacy',role:'citizen',text:'기존 추가 내용',attachments:[{id:'photo',name:'old.png'}]}],row={status:'waiting',title:'기존 민원',body:'기존 내용',supplements:JSON.stringify(history)};
 const c=server.decodeComplaint(row);assert.equal(c.status,'reviewing');assert.deepEqual(c.supplements,history);assert.equal(row.status,'waiting');
});

test('task updates return the saved state and exact history without rewriting the reply',async()=>{
 process.env.SITE_MODE='staff';
 const tasks=[{id:'a',label:'현장 위치 확인',done:false},{id:'b',label:'수거 일정 안내',done:true}],h=harness({tasks});
 const r=await h.call('tasks',{tasks:[{...tasks[0],done:true,label:'클라이언트가 바꾼 문구'},{...tasks[1],done:false}]});
 assert.equal(r.status,200);const result=await r.json();assert.equal(result.revision,4);assert.equal(result.event.label,'완료: 현장 위치 확인\n완료 취소: 수거 일정 안내');assert.equal(result.tasks[0].label,'현장 위치 확인');
 assert.equal(h.writes.length,1);assert.match(h.writes[0].sql,/INSERT INTO events/);assert.doesNotMatch(h.writes[0].sql,/SET status=|draft=|published=/);
});
test('unchanged tasks do not add history, and concurrent or replaced checklists are rejected',async()=>{
 process.env.SITE_MODE='staff';const tasks=[{id:'a',label:'현장 확인',done:false}],h=harness({tasks});
 assert.equal((await h.call('tasks',{tasks})).status,200);assert.equal(h.writes.length,0);
 assert.equal((await h.call('tasks',{tasks:[{...tasks[0],id:'unknown',done:true}]})).status,409);
 const conflict=harness({tasks,taskConflict:true});assert.equal((await conflict.call('tasks',{tasks:[{...tasks[0],done:true}]})).status,409);
});
