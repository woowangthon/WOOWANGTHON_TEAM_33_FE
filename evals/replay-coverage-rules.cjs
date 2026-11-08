// Reproduce code decisions from saved observations, without API calls or gold labels.
const fs=require('node:fs'),crypto=require('node:crypto'),load=require('./loader.cjs')();
const {applyCoverageHarness}=load('lib/coverage-harness.ts'),{draftSentences}=load('lib/review.ts'),{COVERAGE_VERSION}=load('lib/coverage-policy.ts');
const input=process.argv[2];
if(!input)throw Error('Usage: node evals/replay-coverage-rules.cjs RESULT.json [OUTPUT.json]');
const source=JSON.parse(fs.readFileSync(input,'utf8'));
if(source.checkerVersion!==COVERAGE_VERSION)throw Error('Result and code versions differ; use the matching source snapshot');
const result={source:input,checkerVersion:COVERAGE_VERSION,apiCalls:0,reviews:[],hashes:Object.fromEntries([input,'lib/coverage-harness.ts','lib/coverage.ts','lib/coverage-policy.ts','evals/replay-coverage-rules.cjs'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]))};
for(const entry of [...source.cases,...source.boundaries]){
  for(const name of ['detected','repaired','review']){
    const review=entry[name];if(!review)continue;
    if(!review.harness?.plan||!Array.isArray(review.harness.observations))throw Error(`Missing saved observations: ${entry.id}/${name}`);
    const audit={requirements:review.requirements,sourceSnapshot:review.sourceSnapshot,analysisSnapshot:review.analysisSnapshot,noRequestReason:review.noRequestReason,checkedAt:review.checkedAt};
    const replay=applyCoverageHarness(audit,review.draft,draftSentences(review.draft),{observations:review.harness.observations},review.harness.plan);
    const differences=review.requirements.filter(r=>replay.requirements.find(p=>p.id===r.id)?.responseStatus!==r.responseStatus).map(r=>r.id);
    result.reviews.push({caseId:entry.id,stage:name,pass:!differences.length,differences,rules:replay.harness.decisions});
  }
}
result.passed=result.reviews.length>0&&result.reviews.every(r=>r.pass);
if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({passed:result.passed,reviewCount:result.reviews.length,apiCalls:0,differences:result.reviews.filter(r=>!r.pass)}));
if(!result.passed)process.exitCode=1;
