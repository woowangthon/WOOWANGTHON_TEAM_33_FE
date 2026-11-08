import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {createPhoneServer} from './server.mjs';
import {signTicket} from './token.mjs';
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
async function until(predicate){const at=Date.now();while(!predicate()){if(Date.now()-at>4000)throw new Error('Protocol_test_timeout');await delay(5);}}
test('official carrier protocol: webhook to duplex call, protection, immediate hangup, final text',async()=>{
  let callbacks,finishReview;let analyzedFrames=0;
  const app=createPhoneServer({secret:'test',key:'unused',providerToken:'provider',publicUrl:'https://bridge.test',origins:['https://staff.test'],analysisFactory:options=>{callbacks=options;return{start:async()=>{},push:()=>analyzedFrames++,stop:()=>new Promise(resolve=>{finishReview=()=>{options.onText({turnId:'last',text:'마지막 요청',facts:[],status:'audio_rechecked'});resolve();};})};}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+app.server.address().port,sockets=[];
  async function socket(path,origin){const peer=new Ws(base.replace('http:','ws:')+path,origin?{origin}:{}),events=[];sockets.push(peer);peer.on('message',data=>events.push(JSON.parse(data)));await until(()=>peer.readyState===Ws.OPEN);return{peer,events,send:event=>peer.send(JSON.stringify(event))};}
  try{
    assert.equal((await fetch(base+'/provider/voice?token=wrong',{method:'POST'})).status,404);
    const offline=await(await fetch(base+'/provider/voice?token=provider',{method:'POST'})).text();assert.match(offline,/<Hangup\/>/);assert.doesNotMatch(offline,/<Stream/);
    const staff=await socket('/connect','https://staff.test');staff.send({event:'auth',token:signTicket('test',{role:'staff'})});await until(()=>staff.events.some(event=>event.event==='ready'));
    const xml=await(await fetch(base+'/provider/voice?token=provider',{method:'POST',body:'CallId=CA_TEST'})).text();
    assert.match(xml,/<\/Connect><Hangup\/>/);const token=xml.match(/<Parameter name="token" value="([^"]+)"/)[1];
    const carrier=await socket('/carrier');carrier.send({event:'connected',protocol:'Call',version:'1.0.0'});carrier.send({event:'start',start:{streamId:'MZ_TEST',callId:'CA_TEST',accountId:'AC_TEST',tracks:['inbound'],mediaFormat:{encoding:'audio/x-mulaw',sampleRate:8000,channels:1},customParameters:{token}}});
    await until(()=>app.calls.size===1);const call=[...app.calls.values()][0];assert.equal(call.source,'phone');staff.send({event:'accept',callId:call.id});await until(()=>call.ready);
    const payload=Buffer.alloc(160,128).toString('base64');carrier.send({event:'media',sequenceNumber:'2',media:{track:'inbound',chunk:'1',timestamp:'0',payload}});staff.send({event:'media',callId:call.id,payload});
    await until(()=>staff.events.some(event=>event.event==='media')&&carrier.events.some(event=>event.event==='media'));
    assert.deepEqual(carrier.events,[{event:'media',media:{payload}}]);
    callbacks.onShield();await until(()=>staff.events.some(event=>event.event==='clear'));const heard=staff.events.filter(event=>event.event==='media').length;
    carrier.send({event:'media',media:{payload}});staff.send({event:'media',callId:call.id,payload});await until(()=>analyzedFrames===2&&carrier.events.length===2);assert.equal(staff.events.filter(event=>event.event==='media').length,heard);
    callbacks.onText({turnId:'clean',text:'쓰레기 수거 요청',facts:[],status:'audio_rechecked'});assert.ok(carrier.events.every(event=>event.event==='media'));
    staff.send({event:'hangup',callId:call.id});await until(()=>carrier.peer.readyState===Ws.CLOSED);assert.equal(call.finalized,undefined,'telephone must close before final AI jobs settle');
    finishReview();await until(()=>call.finalized);assert.equal(call.segments.at(-1).text,'마지막 요청');
    const replay=await socket('/carrier');replay.send({event:'start',start:{mediaFormat:{encoding:'audio/x-mulaw',sampleRate:8000,channels:1},customParameters:{token}}});await until(()=>replay.peer.readyState===Ws.CLOSED);assert.equal(app.calls.size,1);
  }finally{finishReview?.();for(const peer of sockets)peer.terminate();await app.close();}
});
