const {test}=require('node:test'),assert=require('node:assert/strict');
const {detection,extraction}=require('../evals/public-pilot-metrics.cjs');
test('unavailable positive predictions remain in the recall denominator',()=>{
 const samples=[{id:'a',expectedKinds:['profanity']},{id:'b',expectedKinds:['profanity']},{id:'c',expectedKinds:[]}];
 const results=new Map([['a',{analysis:{shieldLevel:'caution'}}],['c',{analysis:{shieldLevel:'normal'}}]]);
 const m=detection(samples,results);assert.equal(m.recall,.5);assert.equal(m.unavailablePositive,1);assert.equal(m.available,2);assert.equal(m.accuracyAvailable,1);
});
test('normal complaints flagged caution are false alarms',()=>{
 const m=detection([{id:'a',expectedKinds:[]}],new Map([['a',{analysis:{shieldLevel:'caution'}}]]));
 assert.equal(m.fp,1);assert.equal(m.falsePositiveRateAvailable,1);assert.equal(m.recall,null);
});
test('ungraded references never silently disappear and partial preservation is not full preservation',()=>{
 const samples=[{id:'a',requirements:[{id:'R1'},{id:'R2'}]},{id:'b',requirements:[{id:'R1'}]}];
 const result=new Map([['a',{grade:{views:[{id:'analysis',goldChecks:[{id:'R1',status:'preserved'},{id:'R2',status:'partial'}],extractedChecks:[{index:1,supported:true},{index:2,supported:false}]}]}}]]);
 const m=extraction(samples,result,'analysis');assert.equal(m.referenceRequirements,3);assert.equal(m.preserved,1);assert.equal(m.partial,1);assert.equal(m.ungraded,1);assert.equal(m.preservationRateGraded,.5);assert.equal(m.preservationRateAll,.333333);assert.equal(m.unsupportedRequests,1);
});
test('duplicate judge labels are rejected instead of inflating scores',()=>{
 const samples=[{id:'a',requirements:[{id:'R1'},{id:'R2'}]}];
 const result=new Map([['a',{grade:{views:[{id:'audit',goldChecks:[{id:'R1',status:'preserved'},{id:'R1',status:'preserved'}],extractedChecks:[]}]}}]]);
 assert.throws(()=>extraction(samples,result,'audit'),/Invalid grade/);
});
