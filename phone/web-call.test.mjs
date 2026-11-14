import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {createPhoneServer} from './server.mjs';
import {signTicket,verifyTicket} from './token.mjs';
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
const until=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>3000)throw new Error('Condition timed out');await delay(5);}};

async function setup(t,options={}){
  const app=createPhoneServer({secret:'test-only',key:'not-an-api-key',origins:['https://test.local'],analysisFactory:()=>({start:async()=>{},stop:async()=>{},push:()=>{}}),...options});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port,sockets=[];
  t.after(async()=>{sockets.forEach(s=>s.terminate());await app.close();});
  async function connect(role,token=signTicket('test-only',{role})){
    const ws=new Ws(base.replace('http:','ws:')+'/connect',{origin:'https://test.local'}),events=[];
    sockets.push(ws);ws.on('error',()=>{});ws.on('message',b=>events.push(JSON.parse(b)));
    await until(()=>ws.readyState===Ws.OPEN);ws.send(JSON.stringify({event:'auth',token}));
    return{ws,events,send:e=>ws.send(JSON.stringify(e))};
  }
  async function pair(){const staff=await connect('staff');await until(()=>staff.events.some(e=>e.event==='ready'));const caller=await connect('caller');await until(()=>caller.events.some(e=>e.event==='waiting'));const call=app.calls.get(caller.events.find(e=>e.event==='waiting').callId);return{staff,caller,call};}
  return{app,base,connect,pair};
}

test('tickets expire at the boundary and never authorize the disabled telephone transport',()=>{
  assert.throws(()=>verifyTicket('x',signTicket('x',{role:'caller'},0)));
  assert.throws(()=>verifyTicket('x',signTicket('x',{role:'carrier'})));
});

test('WebSocket rejects foreign origins, old carrier endpoints and reused tickets',async t=>{
  const {base,connect}=await setup(t);
  for(const [path,origin] of [['/carrier','https://test.local'],['/connect','https://evil.test']]){
    const status=await new Promise(resolve=>{const ws=new Ws(base.replace('http:','ws:')+path,{origin});ws.on('unexpected-response',(_req,res)=>{res.resume();ws.terminate();resolve(res.statusCode);});ws.on('error',()=>{});});
    assert.equal(status,403);
  }
  const token=signTicket('test-only',{role:'staff'});
  const first=await connect('staff',token);await until(()=>first.events.some(e=>e.event==='ready'));
  const replay=await connect('staff',token);await until(()=>replay.ws.readyState===Ws.CLOSED);
  assert.equal(replay.events.some(e=>e.event==='ready'),false);
});

test('waiting caller is notified as soon as the last officer disconnects',async t=>{
  const {pair,base}=await setup(t);const {staff,caller,call}=await pair();
  assert.equal((await(await fetch(base+'/health')).json()).acceptingCalls,true);
  staff.ws.terminate();await until(()=>caller.events.some(e=>e.event==='ended'));
  assert.ok(call.ended);assert.match(call.reason,/담당자/);
  assert.equal((await(await fetch(base+'/health')).json()).acceptingCalls,false);
});

test('cancel during AI startup never activates a ghost call',async t=>{
  let start,stops=0;const {pair}=await setup(t,{analysisFactory:()=>({start:()=>new Promise(resolve=>{start=resolve;}),stop:async()=>{stops++;},push:()=>{}})});
  const {staff,caller,call}=await pair();staff.send({event:'accept',callId:call.id});await until(()=>start);
  assert.equal(staff.events.filter(e=>e.event==='calls').at(-1).calls[0].status,'connecting');
  caller.send({event:'hangup'});await until(()=>call.ended);start();await until(()=>stops>=2);
  assert.equal(call.ready,false);assert.equal(staff.events.some(e=>e.event==='active'),false);
});

test('AI startup failure and finalization failure close the call without crashing the bridge',async t=>{
  const {pair}=await setup(t,{analysisFactory:()=>({start:async()=>{throw Error('offline');},stop:async()=>{throw Error('failed review');},push:()=>{}})});
  const {staff,caller,call}=await pair();staff.send({event:'accept',callId:call.id});await until(()=>call.finalized);
  assert.ok(call.ended);assert.equal(call.ready,false);assert.ok(caller.events.some(e=>e.event==='ended'));
});

test('the per-call timer ends both peers, and a second caller can connect',async t=>{
  const {pair,connect}=await setup(t,{maxCallSeconds:.08});const {staff,caller,call}=await pair();
  staff.send({event:'accept',callId:call.id});await until(()=>call.finalized);
  assert.match(call.reason,/상담 시간이 종료/);assert.ok(caller.events.some(e=>e.event==='active'&&e.connectedAt));
  const next=await connect('caller');await until(()=>next.events.some(e=>e.event==='waiting'));
});

test('the shared audio allowance cuts the call and refuses new sessions until reset',async t=>{
  const {pair,connect,base}=await setup(t,{maxDailySeconds:.03});const {staff,caller,call}=await pair();
  staff.send({event:'accept',callId:call.id});await until(()=>call.ready);
  const payload=Buffer.alloc(160,255).toString('base64');caller.send({event:'media',payload});caller.send({event:'media',payload});
  await until(()=>call.finalized);assert.match(call.reason,/이용 한도/);
  const next=await connect('caller');await until(()=>next.events.some(e=>e.event==='ended'));
  assert.equal(next.events.some(e=>e.event==='waiting'),false);
  assert.equal((await(await fetch(base+'/health')).json()).acceptingCalls,false);
});

test('a lost socket is removed by the heartbeat',async t=>{
  const {app,connect}=await setup(t,{heartbeatMs:20});const staff=await connect('staff');await until(()=>staff.events.some(e=>e.event==='ready'));
  const socket=[...app.wss.clients][0];socket.alive=false;await until(()=>staff.ws.readyState===Ws.CLOSED);
});
