const attackKinds=new Set(['profanity','insult','threat','sexual_harassment']);
const rate=(n,d)=>d?Number((n/d).toFixed(6)):null;
const findings=(result,raw=false)=>(raw?result?.rawModel:result?.analysis)?.expressionFindings||[];
function detection(samples,results,raw=false){
 const m={total:samples.length,available:0,positive:0,negative:0,tp:0,fp:0,tn:0,fn:0,unavailablePositive:0,unavailableNegative:0};
 for(const sample of samples){
  const positive=sample.expectedKinds.length>0,r=results.get(sample.id),a=raw?r?.rawModel:r?.analysis;
  m[positive?'positive':'negative']++;
  if(!a){m[positive?'unavailablePositive':'unavailableNegative']++;continue;}
  m.available++;
  const predicted=a.shieldLevel!=='normal';
  m[positive?(predicted?'tp':'fn'):(predicted?'fp':'tn')]++;
 }
 return {...m,precision:rate(m.tp,m.tp+m.fp),recall:rate(m.tp,m.positive),falsePositiveRateAvailable:rate(m.fp,m.fp+m.tn),accuracyAvailable:rate(m.tp+m.tn,m.available),
  f1:rate(2*m.tp,2*m.tp+m.fp+m.fn+m.unavailablePositive)};
}
function extraction(samples,results,view){
 const m={cases:samples.length,gradedCases:0,allRequirementsPreservedCases:0,referenceRequirements:0,gradedRequirements:0,preserved:0,partial:0,missing:0,distorted:0,ungraded:0,extractedRequests:0,supportedRequests:0,unsupportedRequests:0};
 for(const sample of samples){
  m.referenceRequirements+=sample.requirements.length;
  const v=results.get(sample.id)?.grade?.views?.find(g=>g.id===view);
  if(!v){m.ungraded+=sample.requirements.length;continue;}
  if(v.goldChecks.length!==sample.requirements.length||sample.requirements.some(g=>v.goldChecks.filter(x=>x.id===g.id).length!==1))throw Error('Invalid grade cannot contribute to metrics');
  m.gradedCases++;m.gradedRequirements+=v.goldChecks.length;
  if(v.goldChecks.every(c=>c.status==='preserved'))m.allRequirementsPreservedCases++;
  for(const c of v.goldChecks){if(!['preserved','partial','missing','distorted'].includes(c.status))throw Error('Unknown status');m[c.status]++;}
  m.extractedRequests+=v.extractedChecks.length;
  for(const c of v.extractedChecks)m[c.supported?'supportedRequests':'unsupportedRequests']++;
 }
 return {...m,preservationRateAll:rate(m.preserved,m.referenceRequirements),preservationRateGraded:rate(m.preserved,m.gradedRequirements),supportedRequestRate:rate(m.supportedRequests,m.extractedRequests)};
}
function summarize(dataset,report){
 const results=new Map(report.cases.map(c=>[c.id,c])),groups={};
 for(const origin of ['real_public','synthetic']){
  const samples=dataset.cases.filter(c=>c.origin===origin);
  groups[origin]={cases:samples.length,detection:detection(samples,results),rawModelDetection:detection(samples,results,true),analysisExtraction:extraction(samples,results,'analysis'),auditExtraction:extraction(samples,results,'audit')};
 }
 const slices={};
 for(const group of new Set(dataset.cases.map(c=>c.group))){const samples=dataset.cases.filter(c=>c.group===group);slices[group]=detection(samples,results);}
 const kinds={};
 for(const kind of attackKinds){const samples=dataset.cases.filter(c=>c.expectedKinds.includes(kind));const detected=samples.filter(c=>findings(results.get(c.id)).some(f=>f.kind===kind)).length;kinds[kind]={expected:samples.length,detected,recall:rate(detected,samples.length)};}
 const criticismSamples=dataset.cases.filter(c=>typeof c.criticismExpected==='boolean'),criticism={tp:0,fp:0,tn:0,fn:0,unavailable:0};
 for(const c of criticismSamples){const r=results.get(c.id);if(!r?.analysis){criticism.unavailable++;continue;}const pred=findings(r).some(f=>f.kind==='criticism');criticism[c.criticismExpected?(pred?'tp':'fn'):(pred?'fp':'tn')]++;}
 const errors=dataset.cases.filter(c=>results.get(c.id)?.error||!results.get(c.id)?.complete).map(c=>({id:c.id,phase:results.get(c.id)?.failedPhase||'not_run',error:results.get(c.id)?.error||'Not complete'}));
 const evidence=dataset.cases.flatMap(c=>findings(results.get(c.id)).map(f=>({valid:!!c.complaint[f.source]?.includes(f.quote)})));
 const latency=report.cases.map(c=>c.analysisLatencyMs).filter(Number.isFinite).sort((a,b)=>a-b);
 const quantile=q=>latency.length?latency[Math.min(latency.length-1,Math.ceil(q*latency.length)-1)]:null;
 return {datasetHash:report.datasetHash,labelStatus:dataset.labelStatus,model:report.model,
  actualModels:[...new Set(report.calls.map(c=>c.model))],startedAt:report.startedAt,finishedAt:report.finishedAt||null,
  totalCases:dataset.cases.length,completedCases:report.cases.filter(c=>c.complete).length,groups,slices,primaryKindRecall:kinds,
  criticism:{...criticism,labeledCases:criticismSamples.length,recall:rate(criticism.tp,criticism.tp+criticism.fn),precision:rate(criticism.tp,criticism.tp+criticism.fp)},
  exactExpressionQuotes:{total:evidence.length,valid:evidence.filter(x=>x.valid).length},
  analysisLatencyMs:{median:quantile(.5),p95:quantile(.95)},
  apiCalls:report.calls.length,usage:report.calls.reduce((a,c)=>({input_tokens:a.input_tokens+(c.usage?.input_tokens||0),output_tokens:a.output_tokens+(c.usage?.output_tokens||0),total_tokens:a.total_tokens+(c.usage?.total_tokens||0)}),{input_tokens:0,output_tokens:0,total_tokens:0}),
  errors,auditErrors:report.cases.filter(c=>c.auditError).map(c=>({id:c.id,error:c.auditError})),
  adjudication:report.adjudication||null,evaluationHistory:report.evaluationHistory||null,scopeFindings:report.scopeFindings||[],
  limitations:['Assistant-authored reference drafts; no independent human labels.','Same model family semantic judge; not independent validation.','Curated small sample; not a representative field accuracy estimate.','No law retrieval, legal interpretation correctness, end-to-end site or voice evaluation.','Final service postprocessing is evaluated; raw-model scores are a diagnostic comparison, not a controlled intervention.']};
}
module.exports={detection,extraction,summarize};
if(require.main===module){
 const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
 const [datasetPath,reportPath,outputPath]=process.argv.slice(2);if(!outputPath)throw Error('Usage: node evals/public-pilot-metrics.cjs DATASET RUN OUTPUT');
 const raw=fs.readFileSync(datasetPath),dataset=JSON.parse(raw),report=JSON.parse(fs.readFileSync(reportPath));
 if(crypto.createHash('sha256').update(raw).digest('hex')!==report.datasetHash)throw Error('Dataset hash mismatch');
 const summary=summarize(dataset,report);fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,JSON.stringify(summary,null,2));
 console.log(JSON.stringify(summary,null,2));
}
