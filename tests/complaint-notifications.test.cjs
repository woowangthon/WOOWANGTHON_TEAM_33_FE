const fs=require('node:fs'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {setImmediate:tick}=require('node:timers/promises');
function load(file,stubs,timers={setInterval,clearInterval,setTimeout,clearTimeout}){
  const out={};new Function('require','exports',...Object.keys(timers),ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(name in stubs,'Unexpected dependency '+name);return stubs[name];},out,...Object.values(timers));return out;
}
const core=load('lib/complaint-notifications.ts',{'./access':{PUBLIC_OFFICE:'office:public'}});
test('complete responses and final failures enter the staff list; pending work stays hidden',()=>{
  for(const auto_state of ['idle','queued','processing','blocked'])assert.equal(core.visibleComplaint({auto_state,status:'reviewing',analysis:{}}),false);
  assert.equal(core.visibleComplaint({auto_state:'completed',analysis:null}),false);
  assert.equal(core.visibleComplaint({auto_state:'completed',analysis:{}}),true);
  assert.equal(core.visibleComplaint({status:'resolved'}),true);
  assert.equal(core.visibleComplaint({auto_state:'failed',status:'received',analysis:null}),true);
});
test('notifications follow the same office boundaries as the API and strip owner information',()=>{
  const payload=owner=>JSON.stringify({owner,id:'synthetic',revision:4,kind:'completed',body:'must not be sent'});
  assert.deepEqual(core.notificationForOffice(payload('guest:a'),'office:public'),{id:'synthetic',revision:4,kind:'completed'});
  assert.equal(core.notificationForOffice(payload('staff:a'),'office:public'),null);
  assert.equal(core.notificationForOffice(payload('guest:a'),'guest:b'),null);
  assert.equal(core.notificationForOffice(payload('guest:a'),'office:private'),null);
  assert.ok(core.notificationForOffice(payload('staff:a'),'office:private'));
  for(const p of ['bad','null','{}',JSON.stringify({owner:'guest:a',id:'x',revision:'3',kind:'completed'})])assert.equal(core.notificationForOffice(p,'office:public'),null);
});
test('signals wait during edits, coalesce bursts, and fetch once when unblocked',async()=>{
  let blocked=true,count=0;const scheduler=core.createSignalRefresh(async()=>{count++;},()=>blocked,()=>assert.fail());
  scheduler.signal();scheduler.signal();await tick();assert.equal(count,0);
  blocked=false;await scheduler.flush();assert.equal(count,1);
  await tick();await tick();assert.equal(count,1,'there is no periodic refresh');
  scheduler.stop();scheduler.signal();await tick();assert.equal(count,1);
});
test('a completion arriving during a refresh is not lost or fetched concurrently',async()=>{
  let release,count=0,inFlight=0,max=0;
  const scheduler=core.createSignalRefresh(async()=>{count++;inFlight++;max=Math.max(max,inFlight);if(count===1)await new Promise(r=>release=r);inFlight--;},()=>false,()=>assert.fail());
  scheduler.signal();scheduler.signal();scheduler.signal();assert.equal(count,1);
  release();await tick();assert.equal(count,2);assert.equal(max,1);scheduler.stop();
});
function streamHarness({staff=true,fail=false}={}){
  let instance,ends=0;const queries=[],timers=new Set();
  class FakeClient extends EventEmitter {
    constructor(){super();instance=this;}
    async connect(){if(fail)throw Error('connection failed');}
    async query(sql){queries.push(sql);}
    async end(){ends++;}
  }
  const timer=fn=>{timers.add(fn);return fn;},clear=fn=>timers.delete(fn);
  const route=load('app/api/complaint-events/route.ts',{
    pg:{Client:FakeClient},'../../user':{getCurrentUser:async()=>staff?{isStaff:true,isGuest:true,userId:'guest:a'}:null},
    '../../../lib/access':{officeForOwner:()=> 'office:public',publicStaffInbox:()=>true},'../../../lib/complaint-notifications':core
  },{setInterval:timer,clearInterval:clear,setTimeout:timer,clearTimeout:clear});
  process.env.SITE_MODE='staff';process.env.DATABASE_URL_UNPOOLED='postgresql://localhost/synthetic_test';
  const abort=new AbortController();
  return {response:()=>route.GET(new Request('https://test.invalid/api/complaint-events',{signal:abort.signal})),abort,queries,timers,client:()=>instance,ends:()=>ends};
}
test('SSE subscribes once, sends scoped completion signals, and closes connections on abort',async()=>{
  const h=streamHarness(),response=await h.response();assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const reader=response.body.getReader(),decode=x=>new TextDecoder().decode(x.value);
  assert.match(decode(await reader.read()),/retry:/);assert.match(decode(await reader.read()),/event: ready/);assert.deepEqual(h.queries,['LISTEN complaint_changes']);
  for(const callback of [...h.timers].slice(0,1))callback();assert.match(decode(await reader.read()),/keepalive/);assert.equal(h.queries.length,1,'heartbeat does not read DB');
  h.client().emit('notification',{payload:JSON.stringify({owner:'staff:private',id:'private',revision:1,kind:'completed'})});
  h.client().emit('notification',{payload:JSON.stringify({owner:'guest:a',id:'allowed',revision:2,kind:'completed'})});
  const event=decode(await reader.read());assert.match(event,/allowed/);assert.doesNotMatch(event,/private|owner|guest:/);
  h.abort.abort();await tick();assert.equal(h.timers.size,0);assert.equal(h.ends(),1);assert.equal((await reader.read()).done,true);
});
test('SSE rejects unauthenticated access and cleans up a failed connection',async()=>{
  const denied=streamHarness({staff:false});assert.equal((await denied.response()).status,403);assert.equal(denied.client(),undefined);
  const failed=streamHarness({fail:true});assert.equal((await failed.response()).status,503);assert.equal(failed.ends(),1);
});
