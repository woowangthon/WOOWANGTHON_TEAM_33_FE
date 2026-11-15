import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {GeminiTranscriber} from './gemini-transcriber.mjs';
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
async function server(t,handler){const s=new Ws.WebSocketServer({host:'127.0.0.1',port:0});await once(s,'listening');s.on('connection',ws=>ws.on('message',b=>handler(JSON.parse(b.toString()),e=>ws.send(JSON.stringify(e)),ws)));t.after(()=>{for(const ws of s.clients)ws.terminate();s.close();});return ()=>new Ws('ws://127.0.0.1:'+s.address().port);}
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await delay(5);}assert.fail('Protocol event missing');}
test('transcription session emits replaceable partials and real finals while transporting native PCM in 100ms batches',async t=>{
 const updates=[],finals=[],audio=[];const factory=await server(t,(e,send)=>{
  if(e.setup){assert.equal(e.setup.model,'models/gemini-3.5-transcribe-live');assert.equal(e.setup.inputAudioTranscription.mode,'VERBATIM');assert.deepEqual(e.setup.inputAudioTranscription.languageCodes,['ko-KR']);assert.equal(e.setup.tools,undefined);send({setupComplete:{}});}
  if(e.realtimeInput?.audio){audio.push(e.realtimeInput.audio);send({serverContent:{interimInputTranscription:{text:'리뷰슨'}}});send({serverContent:{interimInputTranscription:{text:'리뷰 쓴 사람'}}});send({serverContent:{inputTranscription:{text:'리뷰 쓴 사람'}}});}
 });
 const stt=new GeminiTranscriber({apiKey:'not-used',socketFactory:factory,onInterim:x=>updates.push(x),onFinal:x=>finals.push(x)});t.after(()=>stt.close());await stt.start();for(let n=0;n<5;n++)stt.push(Buffer.alloc(640,n));await until(()=>finals.length);
 assert.deepEqual(updates,['리뷰슨','리뷰 쓴 사람']);assert.deepEqual(finals,['리뷰 쓴 사람']);assert.equal(audio[0].mimeType,'audio/pcm;rate=16000');assert.equal(Buffer.from(audio[0].data,'base64').length,3200);assert.equal(stt.partial,'');
});
test('partial-only audio cannot be silently promoted to a final transcript during shutdown',async t=>{
 const factory=await server(t,(e,send)=>{if(e.setup)send({setupComplete:{}});if(e.realtimeInput?.audioStreamEnd)send({serverContent:{interimInputTranscription:{text:'아직 미완성'}}});});
 const finals=[],stt=new GeminiTranscriber({apiKey:'not-used',socketFactory:factory,finishTimeoutMs:80,onFinal:x=>finals.push(x)});t.after(()=>stt.close());await stt.start();await assert.rejects(stt.finish(),/unfinished_audio/);assert.equal(finals.length,0);
});
test('provider shutdown fails closed with a sanitized code and ignores late transcript events',async t=>{
 const errors=[],updates=[],factory=await server(t,(e,send)=>{if(e.setup)send({error:{code:429,message:'private-provider-detail'}});});
 const stt=new GeminiTranscriber({apiKey:'not-used',socketFactory:factory,onError:e=>errors.push(e),onInterim:e=>updates.push(e)});t.after(()=>stt.close());await assert.rejects(stt.start(),/API_429/);assert.equal(JSON.stringify(errors).includes('private-provider-detail'),false);stt.receive({serverContent:{interimInputTranscription:{text:'late'}}});assert.equal(updates.length,0);
});
test('a final without offsets only inherits its own last timed prefix, never arrival time or a previous turn',()=>{
 const finals=[],stt=new GeminiTranscriber({apiKey:'test',onFinal:(text,range)=>finals.push({text,range})});
 stt.receive({serverContent:{interimInputTranscription:{text:'일반 민원',startOffset:'0.120s',endOffset:'1.640s'}}});
 stt.receive({serverContent:{inputTranscription:{text:'일반 민원입니다'}}});
 stt.receive({serverContent:{inputTranscription:{text:'다음 발화'}}});
 assert.deepEqual(finals.map(f=>f.range),[{startMs:120,endMs:1640},null]);
});
