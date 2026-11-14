const fs=require('node:fs'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../evals/loader.cjs')()('lib/harness-policy.ts');
function load(file,stubs){const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(name in stubs,'Unexpected dependency '+name);return stubs[name];},out);return out;}
class Rejected extends Error {constructor(restartable=true){super('Synthetic rejection');this.retryable=false;this.restartable=restartable;}}
class FatalError extends Error {}
class RetryableError extends Error {}
function workflowHarness({failures=1,permanent=false,interrupted=false,cancelled=false}={}){
 let summaries=0,failed=0;const stages=[],restarts=[];
 const workflow=load('workflows/analyze-complaint.ts',{
  workflow:{FatalError,RetryableError},'../lib/summary-harness':{SummaryRejectedError:Rejected},
  '../lib/analysis-stages':{
   runAnalysisStage:async(_id,_generation,stage)=>{stages.push(stage);if(cancelled)return false;if(permanent)throw Object.assign(Error('Configuration unavailable'),{retryable:false});if(stage==='summary'&&++summaries<=failures)throw new Rejected(!interrupted);return true;},
   prepareSummaryRetry:async(_id,_generation,attempt)=>{restarts.push(attempt);return attempt<=policy.harnessPolicy.summary.automaticRestarts;},
   failAnalysis:async()=>{failed++;},
  }
 });
 return {run:()=>workflow.analyzeComplaint('synthetic',3),stages,restarts,failed:()=>failed};
}
test('a rejected summary automatically regenerates before a final failure is exposed',async()=>{
 const h=workflowHarness();assert.deepEqual(await h.run(),{completed:true});assert.equal(h.failed(),0);assert.deepEqual(h.restarts,[1]);assert.equal(h.stages.filter(s=>s==='summary').length,2);assert.equal(h.stages.filter(s=>s==='finish').length,1);
});
test('persistent rejection stops automatic regeneration and keeps a recoverable failure',async()=>{
 const h=workflowHarness({failures:99});assert.deepEqual(await h.run(),{completed:false});assert.equal(h.failed(),1);assert.deepEqual(h.restarts,[1,2]);assert.equal(h.stages.includes('finish'),false);
});
test('configuration failures and unknown paid repair outcomes do not trigger regeneration',async()=>{
 for(const options of [{permanent:true},{interrupted:true}]){const h=workflowHarness(options);assert.deepEqual(await h.run(),{completed:false});assert.equal(h.failed(),1);assert.deepEqual(h.restarts,[]);}
 const cancelled=workflowHarness({cancelled:true});assert.deepEqual(await cancelled.run(),{cancelled:true});assert.equal(cancelled.failed(),0);
});

function recoveryHarness({factError=false,missing=false,conflict=false,interrupted=false}={}){
 const c={title:'합성 민원',body:'보도를 확인해 주세요.',location:'가상 장소',occurred_at:'2026-11-01',supplements:[]};
 const failure={version:3,sourceHash:'same',model:'synthetic',facts:[],requests:[],attempts:[{summary:'합성 요약',review:{factErrors:factError?[{factId:'F1',reason:'의미 오류'}]:[],omissions:[]},issues:['검증 실패']}]};
 const cp={plan:{facts:[{id:'F1'}]},evidence:{citations:[]},analysis:{summary:'합성 요약'},summaryFailure:failure,summaryProgress:{phase:interrupted?'repairing':'reviewing',repairsUsed:1}},row={analysis_checkpoint:JSON.stringify(cp)};
 const writes=[];
 const api=load('lib/analysis-stages.ts',{
  './server':{database:()=>({prepare:sql=>({bind:(...values)=>({first:async()=>missing?null:row,run:async()=>{writes.push({sql,values});if(conflict)return {meta:{changes:0}};row.analysis_checkpoint=values[0];return {meta:{changes:1}};}})})}),decodeComplaint:()=>c},
  './summary-harness':{sourceHash:()=> 'same',requiredOmissions:r=>r.omissions},'./harness-policy':policy,'./access':{},'./laws':{},'./semantic-search':{},'./ai':{},'./structured-ai':{}
 });
 return {retry:n=>api.prepareSummaryRetry('synthetic',3,n),writes,checkpoint:()=>JSON.parse(row.analysis_checkpoint)};
}
test('automatic regeneration preserves valid evidence and is idempotent after a saved restart',async()=>{
 const h=recoveryHarness();assert.equal(await h.retry(1),true);const cp=h.checkpoint();assert.ok(cp.plan);assert.ok(cp.evidence);assert.equal(cp.analysis,undefined);assert.equal(cp.summaryProgress,undefined);assert.equal(cp.summaryRecovery.used,1);assert.equal(cp.summaryRecovery.failures.length,1);
 assert.equal(await h.retry(1),true);assert.equal(h.writes.length,1);assert.equal(await h.retry(2),false);
});
test('fact errors rebuild the plan; deleted or changed records and uncertain repairs are protected',async()=>{
 const h=recoveryHarness({factError:true});assert.equal(await h.retry(1),true);assert.equal(h.checkpoint().plan,undefined);assert.equal(h.checkpoint().evidence,undefined);
 assert.equal(await recoveryHarness({missing:true}).retry(1),false);assert.equal(await recoveryHarness({interrupted:true}).retry(1),false);
 await assert.rejects(recoveryHarness({conflict:true}).retry(1),/Checkpoint changed/);
});
