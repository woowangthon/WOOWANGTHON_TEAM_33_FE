import test from 'node:test';
import assert from 'node:assert/strict';
import { TextPipeline } from './text-pipeline.mjs';
import { validateNativeReview } from './native-review.mjs';
function extraction(pipeline, result, roles = result.facts.map(()=>'complaint_fact')) {
  pipeline.structured = async name => name === 'voice_fact_roles' ? {items: roles.map((role,id)=>({id,role}))} : result;
}
test('partial transcription is sent to contextual classification without a vocabulary gate', async () => {
  const pipeline = new TextPipeline({ apiKey: 'not-used' });
  pipeline.structured = async (name, schema, instructions, input) => {
    assert.deepEqual(input, {transcript: '도와주세요', partial: true});
    assert.match(instructions, /미완성 전사/);
    return {directAbuse: false, scope: 'normal', category: 'none', evidence: ''};
  };
  assert.equal((await pipeline.checkSafety('도와주세요', {partial: true})).directAbuse, false);
});
test('reported speech and invented evidence cannot trigger automatic protection', async () => {
  const pipeline = new TextPipeline({ apiKey: 'not-used' });
  pipeline.structured = async () => ({ directAbuse: true, scope: 'direct_attack', category:'threat', evidence: '존재하지 않는 공격' });
  assert.equal((await pipeline.checkSafety('제발 너희는 일을 왜 그따위로 하냐')).directAbuse, false);
  pipeline.structured = async () => ({ directAbuse: true, scope: 'reported_speech', category:'profanity', evidence: '병신' });
  assert.equal((await pipeline.checkSafety('저에게 병신이라고 욕했어요')).directAbuse, false);
});
test('facts must cite an exact span of the source transcript', async () => {
  const pipeline = new TextPipeline({ apiKey: 'not-used' });
  pipeline.structured = async () => ({ text: '학교 앞 쓰레기 수거', facts: [{ kind: 'location', value: '학교 앞', evidence: '학교 앞' }] });
  await assert.rejects(pipeline.neutralize('집 앞 쓰레기를 치워 주세요'), /Ungrounded/);
});
test('native audio classification cannot treat a plea or criticism as explicit profanity', () => {
  const transcript = '제발, 너희는 일을 왜 그따위로 하냐? 집 앞 쓰레기를 치워달라고 했잖아.';
  // Captured model failure under minimal reasoning, not a hypothetical stub.
  const checked = validateNativeReview({ transcript, directAbuse: true, uncertain: false, scope:'criticism', category:'none', evidence: '너희는 일을 왜 그따위로 하냐?' });
  assert.equal(checked.directAbuse, false);
  assert.equal(checked.protectionNeedsReview, true);
  assert.equal(checked.transcript, transcript);
  assert.equal(checked.uncertain, false);
});
test('native protection requires a literal explicit phrase and preserves uncertainty', () => {
  assert.equal(validateNativeReview({ transcript: '제발 도와주세요', directAbuse: true, uncertain: false, scope:'direct_attack', category:'profanity', evidence: '시발' }).directAbuse, false);
  assert.equal(validateNativeReview({ transcript: '시발 너희는', directAbuse: true, uncertain: false, scope:'direct_attack', category:'profanity', evidence: '시발 너희는' }).directAbuse, true);
  assert.equal(validateNativeReview({ transcript: '시발 너희는', directAbuse: true, uncertain: true, scope:'direct_attack', category:'profanity', evidence: '시발 너희는' }).uncertain, true);
  assert.throws(() => validateNativeReview({ transcript: '', directAbuse: true, uncertain: false, scope:'direct_attack', category:'profanity', evidence: '' }), /invalid_result/);
});
test('display is composed from grounded facts, ignoring an unsupported generated narrative', async () => {
  const pipeline = new TextPipeline({ apiKey: 'not-used' });
  extraction(pipeline, { text: '이미 처리가 지연되어 위법입니다.', facts: [
    { kind: 'location', value: '집 앞', evidence: '집 앞' },
    { kind: 'request', value: '쓰레기 수거', evidence: '쓰레기를 치워 주세요' },
  ] });
  const result = await pipeline.neutralize('집 앞 쓰레기를 치워 주세요');
  assert.equal(result.text, '위치: 집 앞\n요청: 쓰레기 수거');
  assert.equal(/위법|지연/.test(result.text), false);
});
test('quoted profanity is masked without discarding the report or its private evidence', async () => {
  const pipeline = new TextPipeline({ apiKey: 'not-used' });
  extraction(pipeline, { facts: [
    { kind: 'other', value: '옆집 사람이 병신이라고 욕함', evidence: '옆집 사람이 병신이라고 욕함' },
    { kind: 'request', value: '신고 절차 안내', evidence: '신고 절차를 알려주세요' },
  ] }, ['reported_harm','service_request']);
  const result = await pipeline.neutralize('옆집 사람이 병신이라고 욕함. 신고 절차를 알려주세요');
  assert.equal(result.text.includes('병신'), false);
  assert.equal(result.facts[0].value, '옆집 사람이 [욕설 표현]이라고 욕함');
  assert.equal(result.facts[0].evidence, '옆집 사람이 병신이라고 욕함');
  assert.equal(result.text.includes('신고 절차 안내'), true);
});

test('a grounded direct attack outside the fast vocabulary is not vetoed by a word list',async()=>{
 const pipeline=new TextPipeline({apiKey:'not-used'}),transcript='네 가족을 가만두지 않겠다';
 pipeline.structured=async()=>({directAbuse:true,scope:'direct_attack',category:'threat',evidence:transcript});
 assert.equal((await pipeline.checkSafety(transcript)).directAbuse,true);
 const native=validateNativeReview({transcript,directAbuse:true,uncertain:false,scope:'direct_attack',category:'threat',evidence:transcript});
 assert.equal(native.directAbuse,true);
});

test('partial mode and cancellation reach the real HTTP request contract',async()=>{
 const controller=new AbortController();let called=false;
 const pipeline=new TextPipeline({apiKey:'not-used',fetcher:async(url,options)=>{
   called=true;const body=JSON.parse(options.body);
   assert.equal(url,'https://api.openai.com/v1/responses');
   assert.deepEqual(JSON.parse(body.input),{transcript:'인식 중 문장',partial:true});
   assert.equal(options.signal.aborted,false);
   return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
 }});
 const request=pipeline.checkSafety('인식 중 문장',{partial:true,signal:controller.signal});
 assert.equal(called,true);controller.abort();await assert.rejects(request,{name:'AbortError'});
});

test('a paraphrased personal attack is removed by semantic role, while business requests remain',async()=>{
 const pipeline=new TextPipeline({apiKey:'not-used'}),transcript='담당자는 굶어야 한다. 가로등을 고쳐주세요';
 extraction(pipeline,{facts:[{kind:'other',value:'담당자의 생계가 중단되어야 한다고 발언함',evidence:'담당자는 굶어야 한다'},{kind:'request',value:'가로등 수리',evidence:'가로등을 고쳐주세요'}]},['direct_attack','service_request']);
 const result=await pipeline.neutralize(transcript);assert.equal(result.text,'요청: 가로등 수리');assert.equal(result.facts.length,1);
});
test('a partial or duplicated fact review cannot silently approve unreviewed facts',async()=>{
 const pipeline=new TextPipeline({apiKey:'not-used'}),facts=[{kind:'request',value:'수리',evidence:'수리'},{kind:'request',value:'점검',evidence:'점검'}];
 pipeline.structured=async name=>name==='voice_fact_roles'?{items:[{id:0,role:'service_request'},{id:0,role:'service_request'}]}:{facts};
 await assert.rejects(pipeline.neutralize('수리 및 점검'),/Invalid_fact_review/);
});
test('uncertain business facts fail explicitly instead of becoming a fabricated summary',async()=>{
 const pipeline=new TextPipeline({apiKey:'not-used'});
 extraction(pipeline,{facts:[{kind:'other',value:'판단 불가',evidence:'불명확'}]},['unclear']);
 await assert.rejects(pipeline.neutralize('불명확'),/Unverified_business_fact/);
});
