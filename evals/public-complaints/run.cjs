// Calls the current production modules in isolation. It cannot access the DB.
// Execute deliberately: node --env-file=.env.local evals/public-complaints/run.cjs --live
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),ts=require('typescript');
const root=path.resolve(__dirname,'../..'),folder=path.resolve(root,'../acrc-evaluation');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
class AppError extends Error{constructor(message,status=400,retryable=true){super(message);this.status=status;this.retryable=retryable;}}
const cache=new Map();
function load(file){file=path.resolve(root,file);if(cache.has(file))return cache.get(file);const out={};cache.set(file,out);
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',js)(name=>name==='./server'?{AppError,now:()=>new Date().toISOString(),database:()=>{throw Error('Database is disabled in the public-data evaluation');}}:name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name),out);return out;}
async function main(){
 if(!process.argv.includes('--live'))throw Error('Live API evaluation requires the --live flag');
 const key=process.env.SERVICE_OPENAI_API_KEY||process.env.OPENAI_API_KEY;if(!key)throw Error('Existing service key unavailable');
 const model=process.env.SERVICE_OPENAI_MODEL||'gpt-6-luna',keys={provider:'openai',openai:key,model};
 const dataset=JSON.parse(fs.readFileSync(path.join(folder,'real-complaints.json'),'utf8')),reference=JSON.parse(fs.readFileSync(path.join(folder,'reference.json'),'utf8'));
 if(dataset.cases.some(c=>c.synthetic!==false))throw Error('Only real published sources are allowed');
 for(const c of dataset.cases){const r=reference.cases.find(r=>r.id===c.id);if(!r||r.requests.some(x=>!c.complaint.body.includes(x.quote)))throw Error('Reference quote mismatch: '+c.id);}
 const {semanticPlan}=load('lib/semantic-search.ts'),{generateAnalysis}=load('lib/ai.ts'),{verifyBusinessSummary,SummaryRejectedError}=load('lib/summary-harness.ts'),{harnessPolicy}=load('lib/harness-policy.ts');
 const files=['lib/semantic-search.ts','lib/ai.ts','lib/openai.ts','lib/analysis-contract.ts','lib/structured-ai.ts','lib/summary-harness.ts','lib/harness-policy.ts','lib/protection.ts','lib/citations.ts'];
 const codeHash=hash(files.map(f=>f+'\n'+fs.readFileSync(path.join(root,f),'utf8')).join('\n'));
 const datasetHash=hash(JSON.stringify(dataset.cases.map(c=>({id:c.id,complaint:c.complaint}))));
 const reportPath=path.join(folder,'results.json');let report=fs.existsSync(reportPath)?JSON.parse(fs.readFileSync(reportPath,'utf8')):null;
 if(report&&(report.codeHash!==codeHash||report.datasetHash!==datasetHash||report.model!==model))throw Error('Existing results have different code/data/model; preserve them in another folder first');
 report??={startedAt:new Date().toISOString(),model,harnessVersion:harnessPolicy.version,codeHash,datasetHash,sourceManifest:dataset.manifest,method:'Current fact extraction → generation including contextual expression detection → summary/internal requests verification and configured repair/restart. No gold references go to these modules. No DB, staff UI, phone audio or law retrieval run.',cases:[],calls:[]};
 const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
 if(report.calls.some(c=>c.status==='inflight'||c.status==='outcome_unknown'))throw Error('An earlier API request has an unknown outcome; inspect before a paid retry');
 const realFetch=global.fetch;let activeId='';
 global.fetch=async(url,init)=>{
  if(String(url)!=='https://api.openai.com/v1/responses')throw Error('Unexpected outbound request');
  const body=JSON.parse(init.body),call={caseId:activeId,name:body.text.format.name,startedAt:new Date().toISOString(),status:'inflight'};report.calls.push(call);save();
  try{const response=await realFetch(url,init),data=await response.clone().json().catch(()=>null);Object.assign(call,{status:response.ok?'completed':'error',httpStatus:response.status,elapsedMs:Date.now()-Date.parse(call.startedAt),model:data?.model,usage:data?.usage||null,errorCode:data?.error?.code||null,outputText:data?.output?.filter(x=>x.type==='message').flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('')||null});save();return response;}catch(error){call.status='outcome_unknown';save();throw error;}
 };
 try{
  const limit=Number(process.env.EVAL_CASE_LIMIT||dataset.cases.length);
  for(const entry of dataset.cases.slice(0,limit)){
   const earlier=report.cases.find(c=>c.id===entry.id);
   if(earlier){
    if(!process.argv.includes('--retry-failed')||earlier.status!=='failed'||earlier.error?.retryable===false)continue;
    report.previousRuns??=[];report.previousRuns.push(earlier);report.cases=report.cases.filter(c=>c.id!==entry.id);save();
   }
   activeId=entry.id;const startedAt=Date.now(),c={...entry.complaint,supplements:[],analysis:null},result={id:entry.id,title:c.title,url:entry.provenance.url,startedAt:new Date().toISOString()};
   console.log(`${entry.id}: analysing`);
   try{
    let previous=[],analysis,verified,plan;
    for(let pass=0;pass<=harnessPolicy.summary.automaticRestarts;pass++){
     plan=await semanticPlan(keys,c,previous);result.plan=plan;
     analysis=await generateAnalysis(key,model,c,[],[],'공개 결정례 요약·표현 검사 (법령 검색 제외)','openai',plan.facts,previous);result.generatedAnalysis=analysis;
     try{verified=await verifyBusinessSummary(keys,c,plan.facts,analysis.summary,{requests:analysis.requests,findings:analysis.expressionFindings,onProgress:async progress=>{result.progress=progress;report.activeCase=result;save();}});break;}
     catch(error){if(!(error instanceof SummaryRejectedError))throw error;result.rejections??=[];result.rejections.push(error.audit);if(!error.restartable||pass>=harnessPolicy.summary.automaticRestarts)throw error;previous=error.audit.attempts;}
    }
    result.analysis={...analysis,summary:verified.summary,requests:verified.requests,summaryHarness:verified.audit};result.status='verified';delete result.progress;
   }catch(error){result.status='failed';result.error={message:error.message,status:error.status||null,retryable:error.retryable??null};}
   result.elapsedMs=Date.now()-startedAt;report.cases.push(result);delete report.activeCase;save();console.log(`${entry.id}: ${result.status}`);
   if(result.error?.retryable===false&&!result.rejections)break;
  }
 }finally{global.fetch=realFetch;}
 report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({cases:report.cases.length,verified:report.cases.filter(c=>c.status==='verified').length,failed:report.cases.filter(c=>c.status!=='verified').length,apiCalls:report.calls.length}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
