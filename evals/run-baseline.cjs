const fs=require('fs'),crypto=require('crypto'),load=require('./loader.cjs')();
const {generateAnalysis}=load('evals/baseline-source/lib/ai.ts'),{credentials,database}=load('evals/baseline-source/lib/server.ts'),{retrieve}=load('evals/baseline-source/lib/laws.ts');
const cases=JSON.parse(fs.readFileSync('evals/complaints-40.json','utf8'));
const file='evals/results/baseline.json';
(async()=>{
 const keys=await credentials('office:cheongju:public');if(!keys.openai)throw new Error('Existing service key unavailable');
 const report=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{startedAt:new Date().toISOString(),model:keys.model,datasetHash:crypto.createHash('sha256').update(fs.readFileSync('evals/complaints-40.json')).digest('hex'),labelStatus:'ai_authored_pending_human_review',method:'Frozen production generator, fixed snapshot of existing official legal documents. No gold labels are sent to the generator.',cases:[]};
 const docs=(await database().prepare('SELECT * FROM documents WHERE owner=?').bind('office:cheongju:public').all()).results;
 let cursor=0;async function worker(){while(cursor<cases.length){const sample=cases[cursor++];if(report.cases.some(c=>c.id===sample.id&&c.analysis))continue;const start=Date.now(),evidence=retrieve(docs,sample.complaint);try{const analysis=await generateAnalysis(keys.openai,keys.model,sample.complaint,evidence.citations,evidence.warnings,evidence.mode,'openai');report.cases=report.cases.filter(c=>c.id!==sample.id);report.cases.push({id:sample.id,analysis,citations:evidence.citations,latencyMs:Date.now()-start});}catch(e){report.cases.push({id:sample.id,error:e.message});}report.cases.sort((a,b)=>a.id.localeCompare(b.id));fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(sample.id,report.cases.find(c=>c.id===sample.id)?.error?'FAILED':'saved');}}
 await Promise.all([worker(),worker(),worker()]);report.finishedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({completed:report.cases.filter(c=>c.analysis).length,total:cases.length}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
