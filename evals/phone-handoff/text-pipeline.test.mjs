import test from 'node:test';
import assert from 'node:assert/strict';
import { TextPipeline, needsSafetyCheck, hasExplicitAbuse } from '../../phone/text-pipeline.mjs';
import { validateNativeReview } from '../../phone/native-review.mjs';
test('plea and ordinary criticism cannot pass the explicit-profane fast gate', () => {
  assert.equal(needsSafetyCheck('제발 도와 주세요'), false);
  assert.equal(hasExplicitAbuse('너희는 일을 왜 그따위로 하냐'), false);
  assert.equal(needsSafetyCheck('문제의 시발점은 어디인가요'), false);
  assert.equal(hasExplicitAbuse('씨발 너희는'), true);
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
  pipeline.structured = async () => ({ text: '이미 처리가 지연되어 위법입니다.', facts: [
    { kind: 'location', value: '집 앞', evidence: '집 앞' },
    { kind: 'request', value: '쓰레기 수거', evidence: '쓰레기를 치워 주세요' },
  ] });
  const result = await pipeline.neutralize('집 앞 쓰레기를 치워 주세요');
  assert.equal(result.text, '위치: 집 앞\n요청: 쓰레기 수거');
  assert.equal(/위법|지연/.test(result.text), false);
});
test('quoted profanity is masked without discarding the report or its private evidence', async () => {
  const pipeline = new TextPipeline({ apiKey: 'not-used' });
  pipeline.structured = async () => ({ facts: [
    { kind: 'other', value: '옆집 사람이 병신이라고 욕함', evidence: '옆집 사람이 병신이라고 욕함' },
    { kind: 'request', value: '신고 절차 안내', evidence: '신고 절차를 알려주세요' },
  ] });
  const result = await pipeline.neutralize('옆집 사람이 병신이라고 욕함. 신고 절차를 알려주세요');
  assert.equal(result.text.includes('병신'), false);
  assert.equal(result.facts[0].value, '옆집 사람이 [욕설 표현]이라고 욕함');
  assert.equal(result.facts[0].evidence, '옆집 사람이 병신이라고 욕함');
  assert.equal(result.text.includes('신고 절차 안내'), true);
});

test('a grounded direct attack outside the fast vocabulary is not vetoed by a word list',async()=>{
 const pipeline=new TextPipeline({apiKey:'not-used'}),transcript='네 가족을 가만두지 않겠다';
 assert.equal(hasExplicitAbuse(transcript),false);
 pipeline.structured=async()=>({directAbuse:true,scope:'direct_attack',category:'threat',evidence:transcript});
 assert.equal((await pipeline.checkSafety(transcript)).directAbuse,true);
 const native=validateNativeReview({transcript,directAbuse:true,uncertain:false,scope:'direct_attack',category:'threat',evidence:transcript});
 assert.equal(native.directAbuse,true);
});
