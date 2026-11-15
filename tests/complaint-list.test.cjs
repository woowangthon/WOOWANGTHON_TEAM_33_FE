const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/loader.cjs')();
const {complaintListItem}=load('lib/complaint-list.ts');
const {visibleComplaint}=load('lib/complaint-notifications.ts');
const row={id:'test',title:'씨발 담당자',body:'담당자 씨발, 보도를 점검해 주세요.',category:'기타',location:'',status:'waiting',auto_state:'completed',created_at:'2026-11-15',deleted_at:null,is_sample:0,has_public_source:true};
const direct={source:'body',quote:'씨발',kind:'profanity',scope:'direct_attack'};
test('the list strips source text and full analysis while retaining the protected title and warning',()=>{
  const item=complaintListItem({...row,owner:'private-owner',analysis_checkpoint:'large-private-checkpoint',draft:'private draft',analysis:JSON.stringify({safeTitle:'보도 점검 요청',sensitiveQuotes:['씨발'],requests:['보도 점검'],expressionFindings:[direct],summaryHarness:{private:true}})});
  assert.equal(item.title,'보도 점검 요청');assert.equal(item.status,'reviewing');assert.equal(item.hasSensitiveExpression,true);assert.equal(item.hasPublicSource,true);assert.equal(visibleComplaint(item),true);
  for(const field of ['body','analysis','draft','owner','analysis_checkpoint','summaryHarness'])assert.equal(field in item,false);
  assert.doesNotMatch(JSON.stringify(item),/씨발|private/);
});
test('reported speech, criticism and invented evidence do not become list attack warnings',()=>{
  for(const finding of [{...direct,scope:'reported_speech'},{...direct,scope:'criticism',kind:'criticism'},{...direct,quote:'원문에 없는 표현'}]){
    const item=complaintListItem({...row,analysis:JSON.stringify({expressionFindings:[finding]})});assert.equal(item.hasSensitiveExpression,false);
  }
  assert.equal(complaintListItem({...row,analysis:JSON.stringify({expressionFindings:[]})}).hasSensitiveExpression,false);
});
test('legacy protection and final failure visibility survive without a full analysis payload',()=>{
  const failed=complaintListItem({...row,analysis:null,auto_state:'failed'});assert.equal(visibleComplaint(failed),true);assert.equal(failed.hasSensitiveExpression,true);assert.doesNotMatch(failed.title,/씨발/);
  for(const auto_state of ['queued','processing','completed'])assert.equal(visibleComplaint({...failed,auto_state}),false);
  assert.equal(visibleComplaint({...failed,status:'resolved'}),true);
});
