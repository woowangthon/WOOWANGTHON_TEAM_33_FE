import test from 'node:test';
import assert from 'node:assert/strict';
import {GeminiCallAnalysis} from './gemini-analysis.mjs';
import {groundedTarget} from './gemini-pipeline.mjs';
import {GeminiPipeline} from './gemini-pipeline.mjs';
const normal={directAbuse:false,scope:'normal',category:'none',evidence:'',attackTarget:'none',targetEvidence:''};
const attack={directAbuse:true,scope:'direct_attack',category:'threat',evidence:'너를 해치겠다',attackTarget:'officer',targetEvidence:'너를'};
const settle=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {resolve,promise};};
test('Gemini call defaults to Gemini text processing and needs no OpenAI credential',async()=>{
 const analysis=new GeminiCallAnalysis({geminiKey:'test-only',onText:()=>{},onShield:()=>{},onError:()=>{},transcriberFactory:()=>({start:async()=>{},push:()=>{},finish:async()=>{},close:()=>{}})});
 assert.ok(analysis.pipeline instanceof GeminiPipeline);assert.equal(analysis.pipeline.model,'gemini-3.5-flash-lite');await analysis.stop();
});
function setup(t,overrides={}){
 let callbacks;const shield=[],text=[],transcripts=[],errors=[],done=[],checks=[],audio=[];
 const pipeline={checkSafety:async(input,opts)=>{checks.push({input,opts});return normal;},neutralize:async()=>({text:'',facts:[]}),...overrides};
 const analysis=new GeminiCallAnalysis({geminiKey:'not-used',pipeline,onShield:r=>shield.push(r),onTranscript:r=>transcripts.push(r),onText:r=>text.push(r),onError:e=>errors.push(e),onSettled:id=>done.push(id),transcriberFactory:options=>{callbacks=options;return {start:async()=>{},push:b=>audio.push(b),finish:async()=>{},close:()=>{}};}});
 t.after(()=>analysis.stop());return {analysis,pipeline,shield,text,transcripts,errors,done,checks,audio,get stt(){return callbacks;}};
}

test('empty transcription does not invent an attack warning, while a greeting remains visible',async t=>{
 const s=setup(t,{neutralize:async input=>({text:input,facts:[]})});await s.analysis.start();
 s.stt.onFinal('');await settle();assert.deepEqual(s.transcripts,[]);assert.deepEqual(s.shield,[]);
 s.stt.onFinal('여보세요.');await settle();assert.equal(s.transcripts[0].text,'여보세요.');assert.equal(s.transcripts[0].redacted,false);
});
test('native PCM reaches STT unchanged and an incremental attack protects before final transcription or summary',async t=>{
 const summary=deferred(),s=setup(t,{checkSafety:async()=>attack,neutralize:()=>summary.promise});await s.analysis.start();const pcm=Buffer.alloc(640,12);s.analysis.pushPcm(pcm);assert.equal(s.audio[0],pcm);
 s.stt.onInterim('너를 해치겠다');await settle();assert.equal(s.shield.length,1);assert.equal(s.text.length,0);
 summary.resolve({text:'',facts:[]});
});
test('an old positive from a revised hypothesis cannot activate protection',async t=>{
 const pending=deferred(),s=setup(t,{checkSafety:()=>pending.promise});await s.analysis.start();s.stt.onInterim('너를 해치겠다');await settle();s.stt.onInterim('누군가를 해쳤다는 피해 신고');pending.resolve(attack);await settle();
 assert.equal(s.shield.length,0);
});
test('target must be grounded, and an old contextual attack is not a new attack after resume',()=>{
 assert.equal(groundedTarget({...attack,attackTarget:'third_party'},'너를 해치겠다'),false);
 assert.equal(groundedTarget({...attack,targetEvidence:'만든 대상'},'너를 해치겠다'),false);
 assert.equal(groundedTarget(attack,'너를 해치겠다\n가로등을 점검해 주세요','가로등을 점검해 주세요'),false);
 assert.equal(groundedTarget(attack,'너를 해치겠다','너를 해치겠다'),true);
});
test('final safety starts alongside summary; empty facts settle without generating a boilerplate card',async t=>{
 const pending=deferred(),s=setup(t,{checkSafety:async()=>attack,neutralize:()=>pending.promise});await s.analysis.start();s.stt.onFinal('너를 해치겠다');await settle();assert.equal(s.shield.length,1);assert.equal(s.text.length,0);
 pending.resolve({text:'구체적인 요청 내용을 확인해 주세요.',facts:[]});await settle();assert.equal(s.text.length,0);assert.equal(s.done.length,1);
});
test('stopping aborts incremental work and ignores late protection but keeps completed legitimate facts',async t=>{
 const pending=deferred(),s=setup(t,{checkSafety:()=>pending.promise,neutralize:async()=>({text:'요청: 가로등 점검',facts:[{kind:'request',value:'가로등 점검',evidence:'가로등 점검'}]})});
 await s.analysis.start();s.stt.onFinal('가로등 점검');await settle();const stop=s.analysis.stop();pending.resolve(attack);await stop;assert.equal(s.shield.length,0);assert.equal(s.text.length,1);
});
