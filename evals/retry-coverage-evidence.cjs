// Replay the frozen first-pass decisions through the new bounded evidence retry.
// Never select cases by gold label, false-alert outcome, or desired score.
const fs=require('fs'),crypto=require('crypto'),load=require('./loader.cjs')();
const {credentials}=load('lib/server.ts'),{retryInvalidCoverageEvidence}=load('lib/coverage-ai.ts');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const input='evals/results/coverage-v2-verified.json',output='evals/results/coverage-v2-evidence.json';
const r=read(input),reference=read('evals/results/final-evaluation.json'),base=read('evals/results/baseline.json'),samples=read('evals/complaints-40.json'),old=read('evals/results/coverage-evaluation.json');
const meter={calls:0,inputTokens:0,outputTokens:0},network=global.fetch;
global.fetch=async(...args)=>{if(++meter.calls>12)throw Error('Evidence replay call cap');const response=await network(...args);if(response.ok&&String(args[0]).includes('api.openai.com')){const v=await response.clone().json();meter.inputTokens+=v.usage?.input_tokens||0;meter.outputTokens+=v.usage?.output_tokens||0;}return response;};
async function main(){
 const keys=await credentials('office:cheongju:public');if(keys.model!==r.model||keys.provider!=='openai')throw Error('Model mismatch');
 const changed=[];
 for(const record of r.cases){
  const sample=samples.find(s=>s.id===record.id),c={...sample.complaint,analysis:base.cases.find(b=>b.id===record.id).analysis,supplements:[]};
  const audit={...old.cases.find(s=>s.id===record.id).audit,sourceSnapshot:record.detected.sourceSnapshot,analysisSnapshot:record.detected.analysisSnapshot};
  const detected=await retryInvalidCoverageEvidence(keys,c,audit,record.detected);
  if(detected!==record.detected){
   if(detected.requirements.some(x=>x.responseStatus==='missing'))throw Error('Evidence replay still has missing items: '+record.id+'; preserve previous report and inspect');
   record.priorDetected=record.detected;record.detected=detected;record.repaired=detected;record.afterGrade=reference.cases.find(s=>s.id===record.id).grade;delete record.legalReview;
   record.compared=record.compared.map(g=>({...g,answerFlagged:detected.requirements.some(q=>g.matchedIds.includes(q.id)&&q.responseStatus==='missing')}));changed.push({case:record.id,stage:'initial',...detected.evidenceRetry});
  }else if(record.repaired.repair?.accepted){
   const retried=await retryInvalidCoverageEvidence(keys,c,audit,record.repaired);
   if(retried!==record.repaired){record.repaired=retried;changed.push({case:record.id,stage:'repair_recheck',...retried.evidenceRetry});}
  }
 }
 r.evidenceRetryReplay={input,sha256:hash(input),codeHashes:Object.fromEntries(['lib/coverage-ai.ts','lib/coverage.ts','lib/coverage-policy.ts','lib/coverage-repair.ts','lib/structured-ai.ts'].map(p=>[p,hash(p)])),changed,usage:meter,at:new Date().toISOString(),method:'All 40 frozen initial reviews and accepted repair reviews were passed through retryInvalidCoverageEvidence. Only technical sentence-ID/quote validation failures trigger one additional model call. Other cases, drafts and gold/reference labels are unchanged. No gold labels are sent to retry. No full 40-case regeneration is claimed.'};
 r.usage={calls:r.usage.calls+meter.calls,inputTokens:r.usage.inputTokens+meter.inputTokens,outputTokens:r.usage.outputTokens+meter.outputTokens};
 const all=r.cases.flatMap(c=>c.compared),missing=all.filter(x=>x.answerStatus==='missing'),after=r.cases.flatMap(c=>c.afterGrade.checks.map(g=>({caseId:c.id,...g}))),before=reference.cases.flatMap(c=>c.grade.checks.map(g=>({caseId:c.id,...g})));
 r.metrics={cases:40,errors:0,requirements:all.length,baselineAnswerMissing:missing.length,answerMissingDetected:missing.filter(x=>x.answerFlagged).length,missed:missing.filter(x=>!x.answerFlagged).length,falseAlerts:all.filter(x=>x.answerStatus!=='missing'&&x.answerFlagged).length,repairsAttempted:r.cases.filter(c=>c.repaired.repair).length,repairsAccepted:r.cases.filter(c=>c.repaired.repair?.accepted).length,repairsInvalid:r.cases.filter(c=>c.repaired.repair?.rejection).length,afterAnswerMissing:after.filter(x=>x.answerStatus==='missing').length,afterStatuses:Object.fromEntries(['answered','refused','clarification','missing'].map(s=>[s,after.filter(x=>x.answerStatus===s).length])),newOmissions:after.filter(a=>a.answerStatus==='missing'&&before.find(b=>b.caseId===a.caseId&&b.id===a.id)?.answerStatus!=='missing').length,legalSentencesNeedingReview:r.cases.flatMap(c=>c.legalReview?.sentences||[]).filter(x=>x.status==='needs_review').length,boundaryCases:r.boundaries.length,boundaryPassed:r.boundaries.filter(x=>x.pass).length};
 fs.writeFileSync(output,JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({output,changes:changed,metrics:r.metrics,usage:meter}));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
