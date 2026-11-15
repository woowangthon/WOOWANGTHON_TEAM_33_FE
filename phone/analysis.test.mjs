import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as settle} from 'node:timers/promises';
import {CallAnalysis} from './analysis.mjs';
const normal={directAbuse:false,scope:'normal',category:'none',evidence:''};
function setup(nativeReview=async()=>{throw Error('unexpected fallback');}){
  const shields=[],texts=[],errors=[];
  const analysis=new CallAnalysis({key:'not-used',nativeReview,onShield:(...e)=>shields.push(e),onText:e=>texts.push(e),onError:e=>errors.push(e),onProcessing:()=>{}});
  return {analysis,shields,texts,errors};
}
test('incremental direct attack triggers protection before any final transcription or summary',async()=>{
  const {analysis,shields}=setup(),turn={partial:'네 가족을 가만두지 않겠다'};
  analysis.pipeline.checkSafety=async()=>({directAbuse:true,scope:'direct_attack',category:'threat',evidence:turn.partial});
  analysis.pipeline.verifyAudio=()=>{throw Error('must not wait for audio verification');};
  analysis.pipeline.neutralize=()=>{throw Error('must not wait for summary');};
  analysis.guard(turn);await settle();assert.equal(shields.length,1);analysis.liveSafety.close();
});
test('reported harm, criticism and unclear partials do not automatically cut off audio',async()=>{
  for(const scope of ['reported_speech','criticism','unclear']){
    const {analysis,shields}=setup();analysis.pipeline.checkSafety=async()=>({...normal,scope});
    analysis.guard({partial:'신고 내용'});await settle();assert.equal(shields.length,0);analysis.liveSafety.close();
  }
});
test('final safety starts alongside summary and blocks before slow fact extraction finishes',async()=>{
  const {analysis,shields,texts}=setup();let finishText;
  analysis.pipeline.verifyAudio=async()=>'위협 발화';
  analysis.pipeline.checkSafety=async()=>({directAbuse:true,scope:'direct_attack',category:'threat',evidence:'위협 발화'});
  analysis.pipeline.neutralize=()=>new Promise(resolve=>{finishText=resolve;});
  const reviewing=analysis.review({id:'turn'},Buffer.alloc(3200));await settle();
  assert.equal(shields.length,1);assert.equal(texts.length,0);finishText({text:'',facts:[]});await reviewing;assert.equal(texts.length,1);analysis.liveSafety.close();
});
test('native fallback uses contextual uncertainty without any word-list trigger',async()=>{
  let nativeCalls=0;const {analysis,shields,texts}=setup(async()=>{nativeCalls++;return {transcript:'네 가족을 가만두지 않겠다',uncertain:false,scope:'direct_attack',category:'threat',directAbuse:true,evidence:'네 가족을 가만두지 않겠다'};});
  analysis.pipeline.verifyAudio=async()=>'불명확한 발화';analysis.pipeline.checkSafety=async()=>({...normal,scope:'unclear'});
  const inputs=[];analysis.pipeline.neutralize=async text=>{inputs.push(text);return {text:'',facts:[]};};
  await analysis.review({id:'turn'},Buffer.alloc(3200));assert.equal(nativeCalls,1);assert.equal(shields.length,1);assert.equal(inputs.at(-1),'네 가족을 가만두지 않겠다');assert.equal(texts[0].status,'audio_rechecked');analysis.liveSafety.close();
});
test('a stopped call cannot emit a late automatic protection action',async()=>{
  const {analysis,shields}=setup();let finish;
  analysis.pipeline.checkSafety=()=>new Promise(resolve=>{finish=resolve;});
  analysis.guard({partial:'발화'});await settle();await analysis.stop();
  finish({directAbuse:true,scope:'direct_attack',category:'threat',evidence:'발화'});await settle();assert.equal(shields.length,0);
});
