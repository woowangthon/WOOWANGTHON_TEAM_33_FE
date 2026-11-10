const fs=require('node:fs'),crypto=require('node:crypto'),load=require('./loader.cjs')();
const {generateAnalysis}=load('lib/ai.ts'),{auditRequirements}=load('lib/coverage-ai.ts'),{parseSummaryMemo}=load('lib/summary-memo.ts');
const keys={provider:'openai',model:process.env.SERVICE_OPENAI_MODEL||'gpt-6-luna',openai:process.env.SERVICE_OPENAI_API_KEY||process.env.OPENAI_API_KEY||'',gemini:''};
if(!keys.openai)throw Error('Existing approved API credential unavailable');
const fixtures=[
 {id:'memo-trash',title:'씨발 쓰레기 좀 치워라',category:'생활폐기물',location:'청주시 흥덕구 가상동 가상로 골목 전봇대 앞',
  body:'청주시 흥덕구 가상동 가상로 골목 전봇대 앞에 대형 폐기물과 종량제 봉투가 2주째 쌓여 있습니다. 내가 전화로 3회 문의했는데 매번 확인한다고만 하고 현장 방문도 없었습니다. 도대체 일은 하는 겁니까? 수거 예정일을 알려 주세요. 무단 투기자를 확인해 주고 과태료 부과가 가능한지도 안내해 주세요. 재발 방지를 위한 CCTV 설치 가능 여부도 검토해 주세요. 처리 안 하면 찾아가서 담당자를 때리겠습니다.'},
 {id:'memo-noise',title:'밤마다 공사 소음, 제대로 일 좀 하세요',category:'소음·환경',location:'청주시 상당구 가상동 가상아파트 101동 뒤 공사장',
  body:'청주시 상당구 가상동 가상아파트 101동 뒤 공사장에서 일주일째 밤 10시부터 자정까지 굴착기 소리가 납니다. 관리사무소에 2회 연락했지만 조치가 없었습니다. 그 소음 때문에 아이가 잠을 못 잡니다. 대체 일을 어떻게 하는 겁니까? 허용 작업시간과 소음 기준을 알려 주세요. 현장 소음을 측정하고 야간 작업을 중지할 수 있는지도 답변해 주세요. 재발 방지 대책도 알려 주세요.'},
];
const realFetch=global.fetch,calls=[];
const resultFile='evals/results/summary-memo-20261111.json';
let activeReport;
const save=()=>{if(activeReport)fs.writeFileSync(resultFile,JSON.stringify(activeReport,null,2));};
global.fetch=async(url,options)=>{
 if(String(url)!=='https://api.openai.com/v1/responses')throw Error('Only direct AI requests are allowed in this check');
 const start=Date.now(),r=await realFetch(url,options),body=await r.clone().json().catch(()=>({}));
 calls.push({status:r.status,latencyMs:Date.now()-start,model:body.model,usage:body.usage});save();return r;
};
(async()=>{
 const report={date:'2026-11-11',model:keys.model,inputKind:'synthetic',scope:'Two smoke cases, not an accuracy benchmark; direct API calls, no DB writes',promptSha256:crypto.createHash('sha256').update(fs.readFileSync('lib/gemini.ts')).digest('hex'),cases:[],calls};
 activeReport=report;
 for(const fixture of fixtures){
  const c={...fixture,occurred_at:'',status:'received',analysis:null,supplements:[],draft:'',published:'',tasks:[],is_sample:1,created_at:'',updated_at:'',revision:0};
  const analysis=await generateAnalysis(keys.openai,keys.model,c,[],[],'summary memo smoke; no law retrieval','openai');
  const record={fixture,analysis,audit:null,auditAttempts:[]};report.cases.push(record);save();
  let audit;
  for(let attempt=0;attempt<2;attempt++){
   try{audit=await auditRequirements(keys,{...c,analysis});record.auditAttempts.push({attempt:attempt+1,success:true});break;}
   catch(e){record.auditAttempts.push({attempt:attempt+1,success:false,error:e.message});save();if(attempt===1||!e.message.includes('원문 발췌'))throw e;}
  }
  const memo=parseSummaryMemo(analysis.summary);
  const checks={structuredMemo:!!memo,noNarrativeOrAttack:!/(?:민원인은|라고 설명|요청합니다|씨발|때리겠)/.test(analysis.summary),noRequestsInMemo:!/(?:요청|안내해|검토해)/.test(analysis.summary),allRequestsEndInRequest:analysis.requests.every(r=>r.endsWith('요청')),noEmptyQuestions:analysis.questions.every(q=>q.trim()),allAuditedRequestsPreserved:audit.requirements.length>0&&audit.requirements.every(r=>r.summaryStatus==='preserved')};
  if(fixture.id==='memo-trash')Object.assign(checks,{contactCountPreserved:/(?:3|세)\s*(?:회|차례|번)/.test(analysis.summary),noVisitPreserved:/(?:방문[^\n]*(?:없|미실시)|미방문)/.test(analysis.summary),durationPreserved:/2주/.test(analysis.summary)});
  else Object.assign(checks,{contactCountPreserved:/(?:2|두)\s*(?:회|차례|번)/.test(analysis.summary),sleepHarmPreserved:/피해[^\n]*(?:수면|잠)/.test(analysis.summary)});
  Object.assign(record,{audit,checks});save();
  console.log(JSON.stringify({id:fixture.id,summary:analysis.summary,requests:analysis.requests,checks},null,2));
 }
 report.passed=report.cases.every(c=>Object.values(c.checks).every(Boolean));
 save();
 if(!report.passed)process.exitCode=1;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
