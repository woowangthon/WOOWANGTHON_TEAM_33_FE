import test from 'node:test';
import assert from 'node:assert/strict';
import { HandoffRouter } from './router.mjs';
import { encodeMuLaw, decodeMuLaw } from './audio.mjs';

const abuse = { category: 'profanity', protectiveTakeoverRecommended: true, evidence: '욕설' };
function setup() {
  const caller = [], officer = [], analysis = [];
  const router = new HandoffRouter({ caller: event => caller.push(event), officer: event => officer.push(event), onCallerAudio: data => analysis.push(data) });
  router.start('synthetic-call');
  return { router, caller, officer, analysis };
}
test('G.711 known decode vectors and bounded round-trip error', () => {
  assert.equal(encodeMuLaw(0), 255);
  assert.equal(decodeMuLaw(255), 0);
  assert.equal(decodeMuLaw(0), -32124);
  assert.equal(decodeMuLaw(128), 32124);
  for (let i = -32000; i <= 32000; i += 127) assert.ok(Math.abs(decodeMuLaw(encodeMuLaw(i)) - i) < 1024);
});
test('human conversation relays both ways and copies caller audio to analysis', () => {
  const { router, caller, officer, analysis } = setup();
  router.fromCaller('citizen'); router.fromOfficer('officer', 0); router.fromAi('unexpected', 0);
  assert.equal(officer[0].payload, 'citizen'); assert.deepEqual(analysis, ['citizen']);
  assert.equal(caller.length, 1); assert.equal(caller[0].media.payload, 'officer');
});
test('takeover mutes both officer directions, retains analysis and same call, sends AI', () => {
  const { router, caller, officer, analysis } = setup();
  assert.equal(router.takeover(abuse, '욕설'), true);
  router.fromCaller('next-citizen'); router.fromOfficer('stale-officer', 0); router.fromOfficer('officer', 1);
  router.fromAi('AI', 1);
  assert.equal(officer.filter(e => e.event === 'media').length, 0);
  assert.deepEqual(analysis, ['next-citizen']);
  assert.equal(caller.filter(e => e.event === 'media').length, 1);
  assert.equal(caller.at(-1).media.payload, 'AI');
  assert.equal(router.callId, 'synthetic-call');
});
test('resume drops queued AI and old officer frames, without restarting call', () => {
  const { router, caller, officer } = setup();
  router.takeover(abuse, '욕설'); router.resume();
  router.fromAi('late-ai', 1); router.fromOfficer('old', 0); router.fromOfficer('new', 2); router.fromCaller('citizen');
  assert.equal(caller.filter(e => e.event === 'media').length, 1);
  assert.equal(caller.at(-1).media.payload, 'new'); assert.equal(officer.at(-1).payload, 'citizen');
});
test('criticism, quoted insult, absent evidence, duplicate decisions do not trigger takeover', () => {
  const { router } = setup();
  for (const category of ['criticism', 'quoted_report', 'normal']) assert.equal(router.takeover({ ...abuse, category }, '욕설'), false);
  assert.equal(router.takeover(abuse, '인용 근거 없음'), false);
  assert.equal(router.takeover(abuse, '욕설'), true);
  assert.equal(router.takeover(abuse, '욕설'), false);
});
test('end prevents late AI, caller or officer traffic and prevents reopening', () => {
  const { router, caller, officer, analysis } = setup();
  router.end(); router.fromCaller('late'); router.fromOfficer('late', 0); router.fromAi('late', 0);
  assert.equal(router.takeover(abuse, '욕설'), false); assert.equal(router.resume(), false);
  assert.deepEqual([caller.length, officer.length, analysis.length], [0, 0, 0]);
});
