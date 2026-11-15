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

test('caller speaks while staff replies by text without a staff microphone or STT session',async()=>{
 let analysis,receivedAudio=0;const app=createPhoneServer({secret:'test',key:'test',staffTextOnly:true,origins:['https://test.local'],officerFactory:()=>{throw Error('staff microphone must not be required');},analysisFactory:callbacks=>{analysis=callbacks;return{start:async()=>{},push:()=>receivedAudio++,stop:async()=>{}};}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url='ws://127.0.0.1:'+app.server.address().port+'/connect',sockets=[];
 async function connect(role){const socket=new Ws(url,{origin:'https://test.local'}),events=[];sockets.push(socket);socket.on('message',raw=>events.push(JSON.parse(raw)));await until(()=>socket.readyState===Ws.OPEN);socket.send(JSON.stringify({event:'auth',token:signTicket('test',{role,owner:role,nickname:'검증'})}));return{socket,events,send:value=>socket.send(JSON.stringify(value))};}
 try{
  const staff=await connect('staff');await until(()=>staff.events.some(e=>e.event==='ready'));const caller=await connect('caller');const incoming=await untilResult(()=>caller.events.find(e=>e.event==='waiting'));const id=incoming.callId;
  staff.send({event:'accept',callId:id});await until(()=>caller.events.some(e=>e.event==='active'));assert.equal(app.calls.get(id).officer,null);assert.equal(app.calls.get(id).relay.mode,'shield');
  caller.send({event:'media',payload:Buffer.alloc(160,encodeMuLaw(2500)).toString('base64')});await until(()=>receivedAudio===1);assert.equal(staff.events.some(e=>e.event==='media'),false);
  analysis.onTranscript({turnId:'spoken',text:'집 앞 쓰레기를 수거해 주세요.'});await until(()=>staff.events.some(e=>e.event==='conversation'));
  staff.send({event:'text_message',callId:id,messageId:'reply',text:'위치를 확인한 후 수거 일정을 안내드리겠습니다.'});await until(()=>caller.events.some(e=>e.event==='conversation'&&e.entry.speaker==='staff'));await until(()=>staff.events.some(e=>e.event==='delivered'));assert.equal(caller.events.find(e=>e.event==='conversation'&&e.entry.speaker==='staff').entry.text,'위치를 확인한 후 수거 일정을 안내드리겠습니다.');
  caller.send({event:'text_message',callId:id,messageId:'forged',text:'가짜 담당자 답변'});await delay(30);assert.equal(app.calls.get(id).messages.some(m=>m.id==='forged'),false);
  staff.send({event:'hangup',callId:id});await until(()=>app.calls.get(id).finalized);
 }finally{for(const s of sockets)s.terminate();await app.close();}
});
async function untilResult(check){let result;await until(()=>result=check());return result;}
test('real WebSocket bridge enforces roles, keeps human audio, shields incoming audio, and retains text',async()=>{
 let analysis,position=0;const app=createPhoneServer({secret:'test',key:'not-used',origins:['https://test.local'],providerToken:'provider',publicUrl:'https://phone.test',analysisFactory:callbacks=>{analysis=callbacks;return{start:async()=>{},push:()=>{const startMs=position;position+=20;analysis.onAudioBoundary(String(position),{startMs,endMs:position});analysis.onAudioReviewed(String(position),true);},stop:async()=>{}};}});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const url='ws://127.0.0.1:'+app.server.address().port+'/connect';const connections=[];
 async function connect(role){const socket=new Ws(url,{origin:'https://test.local'}),events=[];socket.on('message',b=>events.push(JSON.parse(b)));await until(()=>socket.readyState===Ws.OPEN);socket.send(JSON.stringify({event:'auth',token:signTicket('test',{role,demo:role==='caller'})}));connections.push(socket);return{socket,events,send:e=>socket.send(JSON.stringify(e))};}
 try{
  const staff=await connect('staff');await until(()=>staff.events.some(e=>e.event==='ready'));
  const caller=await connect('caller');await until(()=>caller.events.some(e=>e.event==='waiting'));const id=caller.events.find(e=>e.event==='waiting').callId;
  assert.equal(app.calls.get(id).source,'demo');
  caller.send({event:'accept',callId:id});await delay(10);assert.equal(app.calls.get(id).accepted,false);
  staff.send({event:'accept',callId:id});await until(()=>caller.events.some(e=>e.event==='active'));
  const payload=Buffer.alloc(160,encodeMuLaw(2500)).toString('base64');caller.send({event:'media',payload});staff.send({event:'media',callId:id,payload});await until(()=>staff.events.some(e=>e.event==='media')&&caller.events.some(e=>e.event==='media'));
  analysis.onShield({directAbuse:true,scope:'direct_attack',category:'threat',evidence:'해치겠다'},'담당자를 해치겠다');await until(()=>staff.events.some(e=>e.event==='clear'));assert.equal(app.calls.get(id).relay.events[0].evidence,'해치겠다');const before=staff.events.filter(e=>e.event==='media').length;
  caller.send({event:'media',payload});staff.send({event:'media',callId:id,payload});await delay(30);assert.equal(caller.events.filter(e=>e.event==='media').length,2,'staff voice continues to reach caller in text mode');assert.ok(caller.events.some(e=>e.event==='announcement'&&e.kind==='text_mode'));assert.equal(staff.events.filter(e=>e.event==='media').length,before);
  analysis.onTranscript({turnId:'chat',text:'쓰레기를 수거해 주세요.',redacted:false});await until(()=>caller.events.some(e=>e.event==='conversation'));assert.equal(caller.events.find(e=>e.event==='conversation').entry.speaker,'caller');
  analysis.onText({turnId:'turn',text:'위치: 집 앞\n요청: 쓰레기 수거',facts:[],status:'audio_rechecked'});await until(()=>staff.events.some(e=>e.event==='neutral_text'));assert.equal(caller.events.some(e=>e.event==='neutral_text'),false);
  staff.send({event:'resume',callId:id});await until(()=>!app.calls.get(id).relay.mode.includes('shield'));caller.send({event:'media',payload});await until(()=>staff.events.filter(e=>e.event==='media').length===before+1);
  const noticeCount=caller.events.filter(e=>e.event==='announcement').length;
  analysis.onError('음성 인식 연결을 확인해 주세요.');await until(()=>caller.events.filter(e=>e.event==='announcement').length>noticeCount);
  const notice=caller.events.filter(e=>e.event==='announcement').at(-1);assert.equal(notice.kind,'protection_notice');assert.equal(notice.text.includes('욕설이 감지'),false);
  staff.send({event:'hangup',callId:id});await until(()=>caller.events.some(e=>e.event==='ended'));assert.ok(app.calls.get(id).ended);
  await until(()=>app.calls.get(id).finalized);analysis.onText({turnId:'late',text:'must not change a finalized call'});assert.equal(app.calls.get(id).segments.length,1);
  const nextCaller=await connect('caller');await until(()=>nextCaller.events.some(e=>e.event==='waiting'));const nextId=nextCaller.events.find(e=>e.event==='waiting').callId;
  staff.send({event:'accept',callId:nextId});await until(()=>nextCaller.events.some(e=>e.event==='active'));assert.notEqual(nextId,id);assert.equal(app.calls.get(nextId).relay.mode,'human');
  staff.send({event:'media',callId:nextId,payload});await until(()=>nextCaller.events.some(e=>e.event==='media'));
  analysis.onTranscript({turnId:'next-greeting',text:'여보세요.',redacted:false});await until(()=>nextCaller.events.some(e=>e.event==='conversation'));assert.equal(nextCaller.events.find(e=>e.event==='conversation').entry.text,'여보세요.');
  staff.send({event:'hangup',callId:nextId});await until(()=>app.calls.get(nextId).finalized);
  const httpUrl=url.replace('ws:','http:').replace('/connect','/provider/voice');assert.equal((await fetch(httpUrl,{method:'POST'})).status,404);
  assert.equal((await fetch(httpUrl+'?token=provider',{method:'POST'})).status,404,'web-only mode must not issue carrier tokens');
 }finally{for(const s of connections)s.terminate();await app.close();}
});
