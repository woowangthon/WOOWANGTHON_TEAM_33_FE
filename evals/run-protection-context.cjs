const fs=require('node:fs'),crypto=require('node:crypto'),{AsyncLocalStorage}=require('node:async_hooks');
const {generateAnalysis}=require('./loader.cjs')()('lib/ai.ts');
const datasetPath=process.argv[3]||'evals/protection-context-24.json',outputPath=process.argv[2];
if(!outputPath||fs.existsSync(outputPath))throw Error('Supply a new result path; existing runs are never overwritten');
const dataset=JSON.parse(fs.readFileSync(datasetPath));
const key=process.env.SERVICE_OPENAI_API_KEY||process.env.OPENAI_API_KEY;
if(!key)throw Error('Approved credential unavailable');
const model=process.env.SERVICE_OPENAI_MODEL||'gpt-6-luna';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const report={date:'2026-11-14',startedAt:new Date().toISOString(),model,datasetHash:hash(fs.readFileSync(datasetPath)),codeHashes:Object.fromEntries(['lib/protection.ts','lib/gemini.ts'].map(f=>[f,hash(fs.readFileSync(f))])),method:'Fresh production AI-only expression classification; no keyword override, law, audit, semantic judge, DB or site calls; labels never sent to the model',labelStatus:dataset.labelStatus,cases:[],calls:[]};
const save=()=>fs.writeFileSync(outputPath,JSON.stringify(report,null,2));
const context=new AsyncLocalStorage(),originalFetch=global.fetch;let calls=0;
global.fetch=async(url,options)=>{
 if(String(url)!=='https://api.openai.com/v1/responses'||++calls>110||report.calls.reduce((n,c)=>n+(c.usage?.total_tokens||0),0)>250000)throw Error('Evaluation network/usage cap');
 const body=JSON.parse(options.body);if(body.store!==false)throw Error('store:false required');
 const start=Date.now(),r=await originalFetch(url,options),data=await r.clone().json().catch(()=>({}));
 const current=context.getStore();report.calls.push({caseId:current?.id,status:r.status,latencyMs:Date.now()-start,usage:data.usage,model:data.model});
 const text=(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
 try{current.rawModel=JSON.parse(text);}catch{}
 save();return r;
};
let cursor=0;
async function worker(){while(cursor<dataset.cases.length){
 const s=dataset.cases[cursor++],positive=s.positive??s.expectedKinds.length>0,record={id:s.id,origin:s.origin||'synthetic_context',expectedPositive:positive};report.cases.push(record);
 await context.run(record,async()=>{
  try{
   const c={...(s.complaint||{title:s.title,body:s.body,category:'기타',location:'가상 지역',occurred_at:''}),analysis:null};
   record.analysis=await generateAnalysis(key,model,c,[],[],'synthetic context evaluation','openai');
   record.predictedPositive=record.analysis.shieldLevel!=='normal';
   if(s.preserveTerm){
    const normalized=x=>x.replace(/\s/g,'');
    const before=normalized([record.rawModel?.summary,...record.rawModel?.requests||[]].join(' '));
    const after=normalized([record.analysis.summary,...record.analysis.requests].join(' '));
    record.neutralTerm={term:s.preserveTerm,inRaw:before.includes(normalized(s.preserveTerm)),inFinal:after.includes(normalized(s.preserveTerm))};
   }
  }catch(e){record.error=e.message;}
  save();console.log(JSON.stringify({id:s.id,expected:positive,predicted:record.predictedPositive,error:record.error||null,neutralTerm:record.neutralTerm}));
 });
}}
(async()=>{
 save();await Promise.all([worker(),worker(),worker()]);
 const metrics={total:dataset.cases.length,tp:0,fp:0,tn:0,fn:0,failed:0,neutralTermsLost:0};
 for(const r of report.cases){if(r.error){metrics.failed++;continue;}metrics[r.expectedPositive?(r.predictedPositive?'tp':'fn'):(r.predictedPositive?'fp':'tn')]++;if(r.neutralTerm?.inRaw&&!r.neutralTerm.inFinal)metrics.neutralTermsLost++;}
 report.metrics=metrics;report.groups={};
 for(const r of report.cases){const g=report.groups[r.origin]??={total:0,tp:0,fp:0,tn:0,fn:0,failed:0};g.total++;if(r.error)g.failed++;else g[r.expectedPositive?(r.predictedPositive?'tp':'fn'):(r.predictedPositive?'fp':'tn')]++;}
 report.finishedAt=new Date().toISOString();save();console.log(JSON.stringify({metrics,groups:report.groups}));
 if(metrics.failed||metrics.fp||metrics.fn||metrics.neutralTermsLost)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
