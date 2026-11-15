const fs=require('node:fs'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
class AppError extends Error { constructor(message,status=400){super(message);this.status=status;} }
function load(file,stubs){
  const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(name in stubs,'Unexpected dependency '+name);return stubs[name];},out);return out;
}
function dispatchHarness(overrides={},options={}){
  const row={auto_state:'queued',analysis:null,workflow_run:null,status:'received',deleted_at:null,analysis_generation:2,...overrides};let starts=0;
  const database=()=>({prepare:sql=>({bind:(...values)=>({
    first:async()=>{
      assert.match(sql,/auto_state IN \('queued','processing'\)/);
      assert.match(sql,/auto_state='idle' AND analysis IS NULL/);
      if(row.workflow_run||row.deleted_at||row.status==='resolved'||!(['queued','processing'].includes(row.auto_state)||(row.auto_state==='idle'&&!row.analysis)))return null;
      row.workflow_run=values[0];row.auto_state='queued';return {analysis_generation:row.analysis_generation};
    },
    run:async()=>{
      if(sql.includes("auto_state='failed'")){row.workflow_run=null;row.auto_state='failed';}
      else {if(options.bookkeepingFailure)throw Error('DB unavailable after dispatch');row.workflow_run=values[0];}
      return {meta:{changes:1}};
    }
  })})});
  const {startAnalysis}=load('lib/analysis-dispatch.ts',{
    'workflow/api':{start:async(_workflow,args)=>{starts++;assert.deepEqual(args,['test',2]);if(options.dispatchFailure)throw Error('Unavailable');return {runId:'run:test'};}},
    '../workflows/analyze-complaint':{analyzeComplaint:()=>{}},'./server':{database,now:()=> 'now',AppError}
  });
  return {row,start:()=>startAnalysis('test'),count:()=>starts};
}
test('concurrent automatic starts claim a queued complaint only once',async()=>{
  const h=dispatchHarness();await Promise.all([h.start(),h.start(),h.start()]);assert.equal(h.count(),1);assert.equal(h.row.workflow_run,'run:test');
});
test('unanalysed idle complaints start automatically; saved or terminal records do not',async()=>{
  const idle=dispatchHarness({auto_state:'idle'});await idle.start();assert.equal(idle.count(),1);
  for(const row of [{auto_state:'completed'},{auto_state:'failed'},{auto_state:'idle',analysis:{}},{deleted_at:'deleted'},{status:'resolved'},{workflow_run:'existing'}]){
    const h=dispatchHarness(row);await h.start();assert.equal(h.count(),0,JSON.stringify(row));
  }
});
test('dispatch failure is visible and polling cannot produce an unbounded retry loop',async()=>{
  const h=dispatchHarness({}, {dispatchFailure:true});await assert.rejects(h.start(),/자동 분석을 시작하지 못했습니다/);
  assert.equal(h.row.auto_state,'failed');await h.start();assert.equal(h.count(),1);
});
test('a dispatched run keeps its claim if saving the workflow ID fails',async()=>{
  const h=dispatchHarness({}, {bookkeepingFailure:true});await assert.rejects(h.start(),/DB unavailable/);
  assert.match(h.row.workflow_run,/^dispatch:/);await h.start();assert.equal(h.count(),1);
});

function apiHarness(overrides={},staff=true){
  const c={id:'test',owner:'guest:test',revision:3,status:'received',auto_state:'idle',analysis:null,tasks:[],...overrides};
  const scheduled=[],starts=[],writes=[];
  const db={prepare:sql=>({bind:(...values)=>({first:async()=>sql.includes('count(*)')?{n:0}:c,all:async()=>({results:[]}),run:async()=>{writes.push({sql,values});return {meta:{changes:1}};}})}),batch:async()=>[]};
  const source=fs.readFileSync('app/api/[...path]/route.ts','utf8');
  const stubs=Object.fromEntries([...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m=>[m[1],{}]));
  Object.assign(stubs,{
    '../../../lib/public-data':{publicDataSource:()=>null},'zod':require('zod'),'next/server':{after:f=>scheduled.push(f)},'../../user':{getCurrentUser:async()=>({userId:'guest:test',isStaff:staff,isGuest:true})},
    '../../../lib/server':{AppError,database:()=>db,now:()=> '2026-11-14T00:00:00.000Z',decodeComplaint:()=>c,eventStatement:()=>({run:async()=>{}}),rateLimit:async()=>{}},
    '../../../lib/analysis-dispatch':{startAnalysis:async id=>starts.push(id)},
    '../../../lib/access':{officeForOwner:()=> 'office:test',officeScope:()=> '1=1',publicStaffInbox:()=>true,publicComplaint:x=>x},
    '../../../lib/types':{categories:['기타'],statuses:{received:'접수',reviewing:'검토 중'}}
  });
  const route=load('app/api/[...path]/route.ts',stubs);
  return {starts,scheduled,writes,flush:async()=>{for(const f of scheduled)await f();},call:async(path,method='GET',input)=>{
    process.env.SITE_MODE=staff?'staff':'citizen';
    return route[method](new Request('https://test.invalid/api/'+path,{method,headers:{Origin:'https://test.invalid','Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})}),{params:Promise.resolve({path:path.split('/')})});
  }};
}
test('web and phone intake dispatch automatically without a separate analyse request',async()=>{
  for(const staff of [false,true]){
    const h=apiHarness({},staff),response=await h.call('complaints','POST',{title:'합성 접수 테스트',body:'현장에 문제가 있어 확인을 요청합니다.',location:'합성 장소',category:'기타',occurredAt:'2026-11-01',consent:true,channel:staff?'phone':'web'});
    assert.equal(response.status,201);const result=await response.json();assert.deepEqual(h.starts,[result.id]);
  }
});
test('opening an unanalysed staff detail automatically dispatches, but completed/citizen/deleted views do not',async()=>{
  for(const state of ['idle','queued']){
    const h=apiHarness({auto_state:state});assert.equal((await h.call('complaints/test')).status,200);await h.flush();assert.deepEqual(h.starts,['test']);
  }
  for(const [row,staff] of [[{auto_state:'completed',analysis:{}},true],[{auto_state:'failed'},true],[{status:'resolved'},true],[{deleted_at:'deleted'},true],[{},false]]){
    const h=apiHarness(row,staff);await h.call('complaints/test?trash=1');await h.flush();assert.equal(h.starts.length,0);
  }
});
test('restoring a complaint without analysis schedules it; restoring an existing result does not',async()=>{
  for(const analysis of [null,{summary:'저장된 결과'}]){
    const h=apiHarness({deleted_at:'deleted',analysis});const response=await h.call('complaints/test','PATCH',{revision:3,action:'restore'});
    assert.equal(response.status,200);await h.flush();assert.equal(h.starts.length,analysis?0:1);
    assert.match(h.writes[0].sql,/THEN 'queued'/);
  }
});
test('harness diagnostics are staff-only, read-only, and omit unrelated checkpoint fields',async()=>{
 const checkpoint={plan:{facts:[]},analysis:{summary:'검사 중인 합성 요약'},secret:'must-not-be-returned'};
 const h=apiHarness({analysis_checkpoint:JSON.stringify(checkpoint)}),response=await h.call('complaints/test/harness');
 assert.equal(response.status,200);const data=await response.json();assert.equal(data.pending.candidate,'검사 중인 합성 요약');assert.doesNotMatch(JSON.stringify(data),/must-not-be-returned/);
 await h.flush();assert.equal(h.starts.length,0);assert.equal(h.writes.length,0);
 assert.equal((await apiHarness({analysis_checkpoint:JSON.stringify(checkpoint)},false).call('complaints/test/harness')).status,403);
});
