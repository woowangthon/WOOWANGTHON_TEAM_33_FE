// This gate cannot replace independent label review; it prevents known regressions.
function quality(report){
  const rows=report.cases.flatMap(c=>c.compared||[]),after=report.cases.flatMap(c=>c.afterGrade?.checks||[]);
  return {cases:report.cases.length,requirements:rows.length,falseAlerts:rows.filter(r=>r.answerStatus!=='missing'&&r.answerFlagged).length,missed:rows.filter(r=>r.answerStatus==='missing'&&!r.answerFlagged).length,afterAnswerMissing:after.filter(r=>r.answerStatus==='missing').length};
}
function releaseGate(candidate,previous){
  const current=quality(candidate),baseline=quality(previous),failures=[];
  if(!candidate.finishedAt||candidate.cases.some(c=>c.error||!c.detected||!c.repaired||!c.afterGrade)||new Set(candidate.cases.map(c=>c.id)).size!==current.cases)failures.push('Incomplete or duplicated cases');
  if(current.cases!==baseline.cases||current.requirements!==baseline.requirements||candidate.cases.flatMap(c=>c.afterGrade?.checks||[]).length!==current.requirements)failures.push('Changed evaluation denominator');
  const labels=r=>r.cases.flatMap(c=>(c.compared||[]).map(x=>`${c.id}:${x.id}:${x.answerStatus}`)).sort();
  if(JSON.stringify(labels(candidate))!==JSON.stringify(labels(previous)))failures.push('Changed cases or frozen reference labels');
  if(candidate.hashes||previous.hashes)for(const path of ['evals/complaints-40.json','evals/results/baseline.json','evals/results/final-evaluation.json','evals/results/coverage-evaluation.json','evals/finalize-evaluation.cjs','evals/coverage-boundaries.json'])if(!candidate.hashes?.[path]||candidate.hashes[path]!==previous.hashes?.[path])failures.push(`Changed frozen input: ${path}`);
  if(candidate.boundaries.length!==previous.boundaries.length||candidate.boundaries.some(b=>b.error||!b.pass))failures.push('Boundary regression or incomplete boundary run');
  for(const metric of ['falseAlerts','missed','afterAnswerMissing'])if(current[metric]>baseline[metric])failures.push(`${metric}: ${baseline[metric]} -> ${current[metric]}`);
  for(const metric of Object.keys(current))if(candidate.metrics?.[metric]!==current[metric])failures.push(`Reported metric mismatch: ${metric}`);
  return {passed:!failures.length,current,baseline,failures};
}
module.exports={releaseGate};
if(require.main===module){
  const fs=require('node:fs'),crypto=require('node:crypto');
  const [current,previous,out]=process.argv.slice(2);
  if(!current||!previous)throw Error('Usage: node evals/coverage-release-gate.cjs CURRENT.json PREVIOUS.json [OUTPUT.json]');
  const read=p=>JSON.parse(fs.readFileSync(p,'utf8')),result=releaseGate(read(current),read(previous));
  result.sources={current,previous};result.hashes=Object.fromEntries([current,previous,__filename].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
  if(out)fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;
}
