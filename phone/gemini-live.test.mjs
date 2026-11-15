import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {GeminiLiveSafety} from './gemini-live.mjs';
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
const normal={directAbuse:false,scope:'normal',category:'none',evidence:''};
const attack={directAbuse:true,scope:'direct_attack',category:'threat',evidence:'가만두지 않겠다'};
async function server(t,onMessage){
 const wss=new Ws.WebSocketServer({host:'127.0.0.1',port:0});await once(wss,'listening');
 wss.on('connection',socket=>socket.on('message',bytes=>onMessage(JSON.parse(bytes.toString()),message=>socket.send(JSON.stringify(message)),socket)));
 t.after(()=>{for(const socket of wss.clients)socket.terminate();wss.close();});
 return ()=>new Ws('ws://127.0.0.1:'+wss.address().port);
}
async function until(predicate){for(let n=0;n<100;n++){if(predicate())return;await delay(5);}assert.fail('Live protocol event was not received');}

test('native audio waits for setup, sends PCM16 and only returns grounded tool results without model audio',async t=>{
 let audio=false,ack=false;const events=[],decisions=[];
 const socketFactory=await server(t,(message,send)=>{
   if(message.setup){assert.equal(message.setup.model,'models/gemini-3.8-live');assert.equal(message.setup.generationConfig.responseModalities[0],'AUDIO');assert.equal(message.setup.realtimeInputConfig.automaticActivityDetection.disabled,false);assert.equal(message.setup.generationConfig.thinkingConfig,undefined);send({setupComplete:{}});}
   if(message.realtimeInput?.audio){audio=true;assert.equal(Buffer.from(message.realtimeInput.audio.data,'base64').length,640);assert.equal(message.realtimeInput.audio.mimeType,'audio/pcm;rate=16000');send({serverContent:{inputTranscription:{text:'가만두지 않겠다'},modelTurn:{parts:[{inlineData:{data:'ignored',mimeType:'audio/pcm'}}]}},toolCall:{functionCalls:[{id:'one',name:'report_safety',args:attack}]}});}
   if(message.toolResponse){ack=true;assert.equal(message.toolResponse.functionResponses[0].response.accepted,true);assert.equal(message.toolResponse.functionResponses[0].response.scheduling,'SILENT');}
 });
 const live=new GeminiLiveSafety({apiKey:'not-a-secret',socketFactory,onDecision:r=>decisions.push(r),onEvent:e=>events.push(e)});t.after(()=>live.close());
 assert.throws(()=>live.push(Buffer.alloc(160)),/not_writable/);await live.start();live.push(Buffer.alloc(160,255));await until(()=>ack);
 assert.equal(audio,true);assert.deepEqual(decisions,[attack]);assert.ok(events.some(e=>e.type==='model_audio_discarded'));
});

test('unmatched evidence stays pending, cancelled calls cannot later activate protection',()=>{
 const decisions=[],live=new GeminiLiveSafety({apiKey:'not-a-secret',onDecision:r=>decisions.push(r)});live.socket={readyState:1,send:()=>{},terminate:()=>{}};
 live.receive({serverContent:{inputTranscription:{text:'협박 피해를 신고합니다'}},toolCall:{functionCalls:[{id:'cancelled',name:'report_safety',args:attack}]}});
 assert.equal(decisions.length,0);assert.equal(live.pending.size,1);
 live.receive({toolCallCancellation:{ids:['cancelled']}});live.receive({serverContent:{inputTranscription:{text:'가만두지 않겠다'}}});assert.equal(decisions.length,0);
 live.close();live.receive({toolCall:{functionCalls:[{id:'late',name:'report_safety',args:attack}]}});assert.equal(decisions.length,0);
});

test('third-party harm remains non-blocking; invalid scopes and duplicate ids cannot become actions',()=>{
 const decisions=[],live=new GeminiLiveSafety({apiKey:'not-a-secret',onDecision:r=>decisions.push(r)});live.socket={readyState:1,send:()=>{},terminate:()=>{}};
 const quoted={...normal,scope:'reported_speech'};
 live.receive({serverContent:{inputTranscription:{text:'이웃에게 협박을 당했습니다. 보호해 주세요.'}},toolCall:{functionCalls:[{id:'quote',name:'report_safety',args:quoted},{id:'invalid',name:'report_safety',args:{...attack,scope:'reported_speech'}}]}});
 live.receive({toolCall:{functionCalls:[{id:'quote',name:'report_safety',args:attack}]}});
 assert.deepEqual(decisions,[quoted]);live.close();
});

test('unexpected close reports a safe model-access code instead of leaking the provider reason',async t=>{
 const socketFactory=await server(t,(message,send,socket)=>{if(message.setup)socket.close(1008,'Model not found; private-provider-detail');});
 const events=[],live=new GeminiLiveSafety({apiKey:'not-a-secret',socketFactory,onEvent:e=>events.push(e)});t.after(()=>live.close());
 await assert.rejects(live.start(),/Gemini_live_model_access_1008/);assert.equal(JSON.stringify(events).includes('private-provider-detail'),false);assert.equal(live.closed,true);
});

test('missing setup acknowledgement times out and closes the transport',async t=>{
 const socketFactory=await server(t,()=>{}),live=new GeminiLiveSafety({apiKey:'not-a-secret',socketFactory,connectTimeoutMs:40});t.after(()=>live.close());
 await assert.rejects(live.start(),/Gemini_live_setup_timeout/);assert.equal(live.closed,true);
});
