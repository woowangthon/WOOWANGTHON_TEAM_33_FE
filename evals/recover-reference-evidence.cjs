const fs=require('node:fs'),crypto=require('node:crypto'),{contiguousEvidence}=require('./reference-evidence.cjs');
const [resultPath,diagnosticPath]=process.argv.slice(2);if(!resultPath||!diagnosticPath)throw Error('Usage: node evals/recover-reference-evidence.cjs RESULT.json DIAGNOSTIC.jsonl');
const report=JSON.parse(fs.readFileSync(resultPath,'utf8')),diagnostics=fs.readFileSync(diagnosticPath,'utf8').trim().split('\n').map(JSON.parse),recovered=[];
for(const c of report.cases){
  if(c.error!=='Invalid reference evidence'||c.afterGrade||!c.repaired?.repair?.accepted)continue;
  const hash=crypto.createHash('sha256').update(c.repaired.draft).digest('hex'),d=diagnostics.find(d=>d.draftSha256===hash);if(!d)continue;
  const checks=d.grade?.checks,ids=c.compared.map(x=>x.id);
  if(!Array.isArray(checks)||checks.length!==ids.length||ids.some(id=>checks.filter(x=>x.id===id).length!==1))throw Error('Invalid reference IDs');
  const corrections=[],normalized=checks.map(g=>{if(!['answered','refused','clarification','missing'].includes(g.answerStatus))throw Error('Invalid reference status');const fixed=contiguousEvidence(c.repaired.draft,g.replyQuote);if(fixed.changed)corrections.push({id:g.id,...fixed});return {...g,replyQuote:fixed.quote};});
  c.afterGrade={checks:normalized};
  c.referenceEvidenceRepair={method:'Ordered verbatim sentences expanded to their contiguous original span. Grade and statuses unchanged.',diagnosticPath,diagnosticSha256:crypto.createHash('sha256').update(fs.readFileSync(diagnosticPath)).digest('hex'),codeSha256:crypto.createHash('sha256').update(fs.readFileSync('evals/reference-evidence.cjs')).digest('hex'),originalGrade:d.grade,corrections};
  // Keep the error marker so the ordinary runner resumes the remaining legal review stage.
  recovered.push(c.id);
}
fs.writeFileSync(resultPath,JSON.stringify(report,null,2));console.log(JSON.stringify({recovered,pending:'Resume the normal runner to finish remaining stages'}));
