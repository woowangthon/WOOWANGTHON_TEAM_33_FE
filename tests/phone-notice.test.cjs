const test=require('node:test'),assert=require('node:assert/strict');
const {phoneNoticeAudio}=require('../evals/loader.cjs')()('lib/phone-notice.ts');
test('only confirmed abuse uses the abuse notification audio',()=>{
  assert.match(phoneNoticeAudio('start'),/call-start-recording/);
  assert.match(phoneNoticeAudio('text_mode'),/text-mode-caller-only/);
  assert.equal(phoneNoticeAudio('protection_notice'),null);
  assert.equal(phoneNoticeAudio('analysis_error'),null);
});
