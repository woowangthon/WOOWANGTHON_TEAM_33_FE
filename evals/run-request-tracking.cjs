// Fresh synthetic development cases, real model audit, frozen inputs. No labels sent to product calls.
const fs=require('fs'),crypto=require('crypto'),load=require('./loader.cjs')();
const {auditRequirements}=load('lib/coverage-ai.ts'),{credentials}=load('lib/server.ts'),{seedTracking,confirmRequests}=load('lib/request-tracking.ts');
const input='evals/request-tracking-12.json',out=process.env.TRACKING_EVAL_OUT||'evals/results/request-tracking-12.json';
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const files=[input,'lib/coverage-ai.ts','lib/coverage.ts','lib/request-tracking.ts','lib/structured-ai.ts','evals/run-request-tracking.cjs'];
const hashes=Object.fromEntries(files.map(p=>[p,hash(p)]));
const report=fs.existsSync(out)?JSON.parse(fs.readFileSync(out,'utf8')):{startedAt:new Date().toISOString(),synthetic:true,labelStatus:'agent_authored_pending_independent_human_review',method:'12 new scenarios, 36 original requirements. Fixed summary keeps first two and omits third. A scripted citizen then corrects the second, withdraws the third, and adds a new request. Audit runs on each version; this is not a same-input before/after accuracy comparison, not end-to-end RAG, and not independent human validation.',hashes,cases:[],usage:{calls:0,inputTokens:0,outputTokens:0}};
if(JSON.stringify(hashes)!==JSON.stringify(report.hashes))throw Error('Frozen inputs/code changed; use a new output path.');
const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2));const net=global.fetch;
global.fetch=async(...args)=>{if(++report.usage.calls>40)throw Error('Evaluation call cap reached');const r=await net(...args);if(r.ok&&String(args[0]).includes('api.openai.com')){const d=await r.clone().json();report.usage.inputTokens+=d.usage?.input_tokens||0;report.usage.outputTokens+=d.usage?.output_tokens||0;}return r;};
function originalMatches(audit,text){return audit.requirements.filter(r=>r.source==='body'&&(text.includes(r.quote)||r.quote.includes(text)));}
(async()=>{
 const keys=await credentials('office:cheongju:public');if(keys.provider!=='openai'||!keys.openai)throw Error('Existing service credentials unavailable');report.model=keys.model;save();
 let cursor=0;const cases=JSON.parse(fs.readFileSync(input,'utf8')).cases;
 async function worker(){while(cursor<cases.length){const s=cases[cursor++];let record=report.cases.find(r=>r.id===s.id)||{id:s.id};if(record.completed)continue;
 try{
 const c={title:s.title,body:s.body,category:'기타',location:'청주시 가상 장소',occurred_at:'2026-11-08',supplements:[],analysis:{summary:s.requests.slice(0,2).join(' '),requests:s.requests.slice(0,2),sensitiveQuotes:[]}};
 record.original=record.original||await auditRequirements(keys,c);save();
 const originalChecks=s.requests.map((text,i)=>{const matches=originalMatches(record.original,text);return {index:i,expectedPreserved:i<2,found:matches.length>0,actualPreserved:matches.some(r=>r.summaryStatus==='preserved')};});record.originalChecks=originalChecks;
 // Exact scripted citizen entries are the fixture's actions, never supplied as answer labels to the model.
 const seed=seedTracking({...c,analysis:{requests:s.requests}});
 const tracking=confirmRequests(seed,[{id:'Q1',text:s.requests[0],withdrawn:false},{id:'Q2',text:s.edited,withdrawn:false},{id:'Q3',text:s.requests[2],withdrawn:true},{text:s.added,withdrawn:false}],'2026-11-08T00:00:00Z');
 record.confirmed=record.confirmed||await auditRequirements(keys,{...c,request_tracking:tracking});
 record.confirmedChecks=record.confirmed.requirements.map(r=>({id:r.id,expectedPreserved:r.id==='Q1',actualPreserved:r.summaryStatus==='preserved'}));record.activeCount=tracking.items.filter(r=>!r.withdrawn).length;
 record.completed=true;delete record.error;
 }catch(e){record.error=e.message;record.errors=[...(record.errors||[]),{at:new Date().toISOString(),message:e.message}];}
 report.cases=report.cases.filter(r=>r.id!==s.id);report.cases.push(record);save();console.log(s.id,record.completed?'complete':'ERROR '+record.error);
 }}await Promise.all([worker(),worker()]);
 const done=report.cases.filter(r=>r.completed),before=done.flatMap(r=>r.originalChecks),after=done.flatMap(r=>r.confirmedChecks);
 const metrics=checks=>({requirements:checks.length,agreement:checks.filter(r=>r.expectedPreserved===r.actualPreserved).length,missedOmissions:checks.filter(r=>!r.expectedPreserved&&r.actualPreserved).length,falseAlerts:checks.filter(r=>r.expectedPreserved&&!r.actualPreserved).length});
 report.metrics={completeCases:done.length,errors:report.cases.filter(r=>!r.completed).length,original:{...metrics(before),extractionMissing:before.filter(r=>!r.found).length},afterCitizenCorrection:{...metrics(after),confirmedRowsPreserved:done.reduce((n,r)=>n+r.confirmed.requirements.length,0),expectedRows:done.reduce((n,r)=>n+r.activeCount,0),withdrawnRowsReintroduced:done.reduce((n,r)=>n+r.confirmed.requirements.filter(q=>q.id==='Q3').length,0)}};
 report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({metrics:report.metrics,usage:report.usage}));if(done.length!==12)process.exitCode=1;
})().catch(e=>{save();console.error(e.message);process.exitCode=1;});
