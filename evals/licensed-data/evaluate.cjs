// Licensed source text -> real analysis modules. No DB, example answers or reference labels.
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
class AppError extends Error{constructor(message,status=400,retryable=true){super(message);this.status=status;this.retryable=retryable;}}
function loader(){const cache=new Map();return function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));const out={};cache.set(file,out);new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(name=>name==='./server'?{AppError,now:()=>new Date().toISOString(),database:()=>{throw Error('Evaluation DB disabled');}}:name.startsWith('.')?load(path.resolve(path.dirname(file),name+(name.endsWith('.json')?'':'.ts'))):require(name),out);return out;};}
async function main(){
 if(!process.argv.includes('--live'))throw Error('Use --live for billable evaluation');
 const key=process.env.SERVICE_OPENAI_API_KEY||process.env.OPENAI_API_KEY;if(!key)throw Error('Existing service key unavailable');
 const load=loader(),{semanticPlan}=load(path.join(root,'lib/semantic-search.ts')),{generateAnalysis}=load(path.join(root,'lib/ai.ts')),{verifyBusinessSummary,SummaryRejectedError,requiredOmissions}=load(path.join(root,'lib/summary-harness.ts')),{verifyReply}=load(path.join(root,'lib/reply-harness.ts'));
 const data=JSON.parse(fs.readFileSync(path.join(root,'lib/public-complaints.json'),'utf8')),keys={openai:key,model:process.env.SERVICE_OPENAI_MODEL||'gpt-6-luna',provider:'openai'};
 if(process.env.EVAL_RECORD_IDS){const selected=new Set(process.env.EVAL_RECORD_IDS.split(','));data.records=data.records.filter(r=>selected.has(r.id));}
 const folder=path.resolve(root,'../licensed-data/submission-evaluation');fs.mkdirSync(folder,{recursive:true});
 const report={startedAt:new Date().toISOString(),model:keys.model,source:data.source,csvSha256:data.csvSha256,method:'Real source text; no agency responses, no synthetic additions, no law retrieval in this isolated evaluation. Summary and reply harness results are automatic checks, not independent accuracy labels.',cases:[]};
 const file=path.join(folder,'results-'+Date.now()+'.json');const save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2));save();
 let cursor=0;async function worker(){for(;;){const row=data.records[cursor++];if(!row)return;const began=Date.now(),c={id:row.id,title:row.complaintContent,body:row.complaintContent,location:'',occurred_at:'',category:'소음·환경',status:'received',analysis:null,tasks:[],draft:'',published:'',is_sample:0,revision:0,created_at:'',updated_at:''};const result={id:row.id,sourceText:row.complaintContent,sourceReceivedAt:row.receivedAt,sourceHash:crypto.createHash('sha256').update(row.complaintContent).digest('hex'),status:'processing'};report.cases.push(result);save();
  try{let plan=await semanticPlan(keys,c),analysis,verified,prior=[];for(let pass=0;pass<2;pass++){
   analysis=await generateAnalysis(key,keys.model,c,[],[],'공개 데이터 독립 검증 · 법령 검색 제외','openai',plan.facts,prior);
   try{verified=await verifyBusinessSummary(keys,c,plan.facts,analysis.summary,{requests:analysis.requests,findings:analysis.expressionFindings});break;}catch(e){if(!(e instanceof SummaryRejectedError)||pass)throw e;prior=e.audit.attempts;if(e.audit.attempts.some(a=>a.review.factErrors.length||requiredOmissions(a.review).length))plan=await semanticPlan(keys,c,prior);}
  }
  analysis={...analysis,summary:verified.summary,requests:verified.requests,summaryHarness:verified.audit};const reply=await verifyReply(keys,c,analysis,[]);result.analysis={...analysis,draft:reply.draft,replyHarness:reply.audit};result.status='verified';
  }catch(error){result.status='failed';result.error=error instanceof AppError?error.message:error instanceof SummaryRejectedError?'Summary verification rejected':error.name;if(error instanceof SummaryRejectedError)result.failureAudit=error.audit;}
  result.elapsedMs=Date.now()-began;save();console.log(JSON.stringify({id:result.id,status:result.status,elapsedMs:result.elapsedMs,error:result.error}));
 }}
 await Promise.all([worker(),worker()]);report.finishedAt=new Date().toISOString();report.counts={total:report.cases.length,verified:report.cases.filter(r=>r.status==='verified').length,failed:report.cases.filter(r=>r.status==='failed').length};save();console.log(JSON.stringify({file,counts:report.counts}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={loader};
