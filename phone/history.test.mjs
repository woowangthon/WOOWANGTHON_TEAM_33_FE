import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {createCallHistory} from './history.mjs';
import {createPhoneServer} from './server.mjs';
import {signTicket} from './token.mjs';
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
async function until(fn){const deadline=Date.now()+5000;while(!fn()){if(Date.now()>deadline)throw Error('Timeout');await delay(5);}}

test('history keeps repeated caller identity and protected messages across restart, never merges names or saves demos',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'phone-history-')),file=join(dir,'calls.json');
  try{
    const history=createCallHistory({file,secret:'test'});
    const first=history.identify('account-a','산책하는곰','browser');
    history.remember({id:'one',source:'browser',...first,status:'ended',startedAt:new Date().toISOString(),messages:[{text:'공원 가로등을 수리해 주세요.'}]});
    const second=history.identify('account-a','다른닉네임','browser');
    assert.equal(second.callerId,first.callerId);assert.equal(second.callerCallNumber,2);
    assert.notEqual(history.identify('account-b','산책하는곰','browser').callerId,first.callerId);
    history.identify('account-a','검증','demo');history.remember({id:'demo',source:'demo'});
    await history.flush();
    const restored=createCallHistory({file,secret:'test'});
    assert.equal(restored.list().length,1);assert.equal(restored.count(first.callerId),2);
    assert.equal(restored.list()[0].messages[0].text,'공원 가로등을 수리해 주세요.');
    assert.equal(restored.identify('account-a','산책하는곰','browser').callerCallNumber,3);
    await restored.flush();assert.ok(!(await readFile(file,'utf8')).includes('account-a'));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('real sockets expose the caller nickname, count repeat calls, protect history access, and restore ended conversations',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'phone-history-ws-')),historyFile=join(dir,'calls.json'),sockets=[];
  let callbacks,app;
  const options={secret:'test',historyFile,origins:['https://test.local'],allowDemo:false,analysisFactory:next=>{callbacks=next;return{start:async()=>{},stop:async()=>{},push:()=>{}};}};
  async function start(){app=createPhoneServer(options);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+app.server.address().port;}
  async function connect(base,claims){const events=[],socket=new Ws(base.replace('http:','ws:')+'/connect',{origin:'https://test.local'});sockets.push(socket);socket.on('message',b=>events.push(JSON.parse(b)));await until(()=>socket.readyState===Ws.OPEN);socket.send(JSON.stringify({event:'auth',token:signTicket('test',claims)}));return{events,send:e=>socket.send(JSON.stringify(e))};}
  try{
    let base=await start();const staff=await connect(base,{role:'staff'});await until(()=>staff.events.some(e=>e.event==='ready'));
    for(let i=1;i<=2;i++){
      const caller=await connect(base,{role:'caller',owner:'caller-a',nickname:'산책하는곰'});await until(()=>caller.events.some(e=>e.event==='waiting'));const id=caller.events.find(e=>e.event==='waiting').callId;
      await until(()=>staff.events.some(e=>e.calls?.some(c=>c.id===id&&c.callerCallCount===i)));
      const row=staff.events.flatMap(e=>e.calls||[]).find(c=>c.id===id);assert.equal(row.callerName,'산책하는곰');
      staff.send({event:'accept',callId:id});await until(()=>caller.events.some(e=>e.event==='active'));
      callbacks.onTranscript({turnId:'turn-'+i,text:'가로등 수리를 요청합니다.'});
      staff.send({event:'hangup',callId:id});await until(()=>app.calls.get(id).finalized);
    }
    const demo=await connect(base,{role:'caller',owner:'demo',nickname:'검증',demo:true});await until(()=>demo.events.some(e=>e.event==='error'));
    assert.equal(app.calls.size,2);
    assert.equal((await fetch(base+'/history')).status,401);
    assert.equal((await fetch(base+'/history',{headers:{Authorization:'Bearer '+signTicket('test',{role:'caller',scope:'history'})}})).status,401);
    await app.close();app=null;base=await start();
    const response=await fetch(base+'/history',{headers:{Authorization:'Bearer '+signTicket('test',{role:'staff',scope:'history'})}});assert.equal(response.status,200);
    const {calls}=await response.json();assert.equal(calls.length,2);assert.ok(calls.every(c=>c.callerName==='산책하는곰'&&c.callerCallCount===2&&c.status==='ended'));assert.ok(calls.every(c=>c.messages[0].text==='가로등 수리를 요청합니다.'));
  }finally{for(const s of sockets)s.terminate();if(app)await app.close();await rm(dir,{recursive:true,force:true});}
});
