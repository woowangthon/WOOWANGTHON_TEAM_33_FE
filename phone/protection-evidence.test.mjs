import test from 'node:test';
import assert from 'node:assert/strict';
import {FilterRelay} from './filter-relay.mjs';
function relay(){const r=new FilterRelay({caller:()=>{},officer:()=>{},onCallerAudio:()=>{}});r.start('synthetic');return r;}
test('automatic phone protection stores actual classification and literal evidence',()=>{
 const r=relay(),transcript='네 가족을 가만두지 않겠다';
 assert.equal(r.enableShield({category:'threat',protectiveTakeoverRecommended:true,evidence:transcript},transcript),true);
 assert.equal(r.events[0].evidence,transcript);assert.equal(r.events[0].category,'threat');assert.equal(r.events[0].source,'ai');
});
test('fabricated evidence cannot activate automatic phone protection',()=>{
 const r=relay();assert.equal(r.enableShield({category:'threat',protectiveTakeoverRecommended:true,evidence:'없는 근거'},'다른 발화'),false);assert.equal(r.mode,'human');assert.deepEqual(r.events,[]);
});
test('manual and analysis-error protection do not fabricate AI evidence or threat classification',()=>{
 for(const source of ['manual','analysis_error']){const r=relay();assert.equal(r.protectManually(source,'담당자 보호'),true);assert.equal(r.events[0].source,source);assert.equal(r.events[0].evidence,undefined);assert.equal(r.events[0].category,undefined);}
});
