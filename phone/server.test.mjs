import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {createPhoneServer} from './server.mjs';
import {signTicket,verifyTicket} from './token.mjs';
import {Segmenter} from './segmenter.mjs';
import {encodeMuLaw} from './audio.mjs';
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
async function until(fn){const at=Date.now();while(!fn()){if(Date.now()-at>4000)throw new Error('Timeout');await delay(5);}}
test('tickets reject tampering and expiration',()=>{const token=signTicket('test',{role:'staff'});assert.equal(verifyTicket('test',token).role,'staff');assert.throws(()=>verifyTicket('wrong',token));assert.throws(()=>verifyTicket('test',signTicket('test',{role:'caller'},-1)));});
test('endpointing keeps pre-roll, commits silence, and bounds a long utterance',()=>{const turns=[];let count=0;const vad=new Segmenter({onStart:()=>{},onFrame:()=>count++,onEnd:(audio,voiced)=>turns.push({audio,voiced}),maxFrames:60});const silence=Buffer.alloc(160,255),voice=Buffer.alloc(160,encodeMuLaw(3000));for(let i=0;i<20;i++)vad.push(silence);assert.equal(count,0);for(let i=0;i<8;i++)vad.push(voice);for(let i=0;i<30;i++)vad.push(silence);assert.equal(turns.length,1);assert.equal(turns[0].voiced,true);for(let i=0;i<130;i++)vad.push(voice);assert.equal(turns.length,3);vad.flush();assert.equal(turns.length,4);});
test('real WebSocket bridge enforces roles, keeps human audio, shields incoming audio, and retains text',async()=>{
 let analysis;const app=createPhoneServer({secret:'test',key:'not-used',origins:['https://test.local'],providerToken:'provider',publicUrl:'https://phone.test',analysisFactory:callbacks=>{analysis=callbacks;return{start:async()=>{},push:()=>{},stop:async()=>{}};}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url='ws://127.0.0.1:'+app.server.address().port+'/connect';const connections=[];
 async function connect(role){const socket=new Ws(url,{origin:'https://test.local'}),events=[];socket.on('message',b=>events.push(JSON.parse(b)));await until(()=>socket.readyState===Ws.OPEN);socket.send(JSON.stringify({event:'auth',token:signTicket('test',{role,demo:role==='caller'})}));connections.push(socket);return{socket,events,send:e=>socket.send(JSON.stringify(e))};}
 try{
  const staff=await connect('staff');await until(()=>staff.events.some(e=>e.event==='ready'));
  const caller=await connect('caller');await until(()=>caller.events.some(e=>e.event==='waiting'));const id=caller.events.find(e=>e.event==='waiting').callId;
  assert.equal(app.calls.get(id).source,'demo');
  caller.send({event:'accept',callId:id});await delay(10);assert.equal(app.calls.get(id).accepted,false);
  staff.send({event:'accept',callId:id});await until(()=>caller.events.some(e=>e.event==='active'));
  const payload=Buffer.alloc(160,encodeMuLaw(2500)).toString('base64');caller.send({event:'media',payload});staff.send({event:'media',callId:id,payload});await until(()=>staff.events.some(e=>e.event==='media')&&caller.events.some(e=>e.event==='media'));
  analysis.onShield();await until(()=>staff.events.some(e=>e.event==='clear'));const before=staff.events.filter(e=>e.event==='media').length;
  caller.send({event:'media',payload});staff.send({event:'media',callId:id,payload});await until(()=>caller.events.filter(e=>e.event==='media').length===2);assert.equal(staff.events.filter(e=>e.event==='media').length,before);
  analysis.onText({turnId:'turn',text:'위치: 집 앞\n요청: 쓰레기 수거',facts:[],status:'audio_rechecked'});await until(()=>staff.events.some(e=>e.event==='neutral_text'));assert.equal(caller.events.some(e=>e.event==='neutral_text'),false);
  staff.send({event:'resume',callId:id});await until(()=>!app.calls.get(id).relay.mode.includes('shield'));caller.send({event:'media',payload});await until(()=>staff.events.filter(e=>e.event==='media').length===before+1);
  staff.send({event:'hangup',callId:id});await until(()=>caller.events.some(e=>e.event==='ended'));assert.ok(app.calls.get(id).ended);
  await until(()=>app.calls.get(id).finalized);analysis.onText({turnId:'late',text:'must not change a finalized call'});assert.equal(app.calls.get(id).segments.length,1);
  const httpUrl=url.replace('ws:','http:').replace('/connect','/provider/voice');assert.equal((await fetch(httpUrl,{method:'POST'})).status,404);
  const response=await fetch(httpUrl+'?token=provider',{method:'POST'});const xml=await response.text();assert.match(xml,/<Stream url="wss:/);assert.match(xml,/<Parameter name="token"/);
 }finally{for(const s of connections)s.terminate();await app.close();}
});
