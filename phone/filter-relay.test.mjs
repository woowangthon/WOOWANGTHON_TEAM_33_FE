import test from 'node:test';
import assert from 'node:assert/strict';
import { FilterRelay } from './filter-relay.mjs';
const decision = { category: 'profanity', protectiveTakeoverRecommended: true, evidence: '욕설' };
function setup() {
  const caller = [], officer = [], analysis = [];
  const relay = new FilterRelay({ caller: event => caller.push(event), officer: event => officer.push(event), onCallerAudio: audio => analysis.push(audio) });
  relay.start('same-call');
  return { relay, caller, officer, analysis };
}
test('normal call relays both humans and copies caller audio for analysis', () => {
  const { relay, caller, officer, analysis } = setup();
  relay.fromCaller('citizen'); relay.fromOfficer('human-answer');
  assert.equal(officer[0].payload, 'citizen'); assert.equal(caller[0].media.payload, 'human-answer');
  assert.deepEqual(analysis, ['citizen']);
});
test('shield blocks original caller audio, keeps STT and human microphone live', () => {
  const { relay, caller, officer, analysis } = setup();
  assert.equal(relay.enableShield(decision, '욕설'), true);
  relay.fromCaller('offensive-original'); relay.fromOfficer('human-answer');
  assert.equal(officer.filter(e => e.event === 'media').length, 0);
  assert.equal(caller[0].media.payload, 'human-answer'); assert.deepEqual(analysis, ['offensive-original']);
  assert.equal(relay.callId, 'same-call');
});
test('sanitized text goes only to the officer, with no AI media or raw evidence', () => {
  const { relay, caller, officer } = setup();
  relay.enableShield(decision, '욕설');
  relay.publishText({ turnId: 'turn-1', revision: 1, text: '쓰레기 수거 요청', raw: '욕설', facts: [{ kind: 'request', value: '수거', evidence: '욕설 원문' }] });
  assert.equal(officer.at(-1).event, 'neutral_text'); assert.equal(officer.at(-1).text, '쓰레기 수거 요청');
  assert.equal(JSON.stringify(officer).includes('욕설'), false);
  assert.equal(officer.filter(e => e.event === 'media').length, 0); assert.equal(caller.length, 0);
});
test('restoring raw audio preserves human answers and text summary', () => {
  const { relay, caller, officer } = setup();
  relay.enableShield(decision, '욕설');
  relay.resume(); relay.publishText({ turnId: 'turn-1', revision: 1, text: '요구 요약' }); relay.fromCaller('original'); relay.fromOfficer('human');
  assert.equal(officer.filter(e => e.event === 'media').length, 1);
  assert.equal(officer.at(-1).payload, 'original'); assert.equal(caller[0].media.payload, 'human');
});
test('quoted insults, criticism, ungrounded or duplicate decisions cannot enable shield', () => {
  const { relay } = setup();
  for (const category of ['normal', 'criticism', 'quoted_report']) assert.equal(relay.enableShield({ ...decision, category }, '욕설'), false);
  assert.equal(relay.enableShield(decision, '근거 없음'), false);
  assert.equal(relay.enableShield(decision, '욕설'), true);
  assert.equal(relay.enableShield(decision, '욕설'), false);
});
test('ending call rejects late human audio, original audio and text updates', () => {
  const { relay, caller, officer, analysis } = setup();
  relay.end(); relay.fromCaller('late'); relay.fromOfficer('late'); relay.publishText({ turnId: 'turn-1', revision: 1, text: 'late' });
  assert.equal(relay.enableShield(decision, '욕설'), false); assert.equal(relay.resume(), false);
  assert.deepEqual([caller.length, officer.length, analysis.length], [0, 0, 0]);
});
test('out-of-order revisions cannot replace newer text or another turn', () => {
  const { relay, officer } = setup();
  assert.equal(relay.publishText({ turnId: 'turn-1', revision: 2, text: '원음 재확인 결과' }), true);
  assert.equal(relay.publishText({ turnId: 'turn-1', revision: 1, text: '늦게 온 초안' }), false);
  assert.equal(relay.publishText({ turnId: 'turn-2', revision: 1, text: '다음 요구' }), true);
  assert.equal(officer.filter(e => e.event === 'neutral_text').length, 2);
});
