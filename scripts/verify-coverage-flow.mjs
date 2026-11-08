// Creates only a marked synthetic case and soft-deletes it in finally.
// Guest session cookies remain in memory and are never printed or saved.
import fs from 'node:fs';
const citizen='https://shield-and-solve.vercel.app',staff='https://shield-solve-staff.vercel.app';
const expectedVersion=Number(process.env.EXPECTED_COVERAGE_VERSION||7);
const report={startedAt:new Date().toISOString(),synthetic:true,checks:{},transitions:[]};
const jar=new Map();let id;
async function req(origin,path,options={}){
 const headers={...(jar.get(origin)?{cookie:jar.get(origin)}:{}),...options.headers};
 const r=await fetch(origin+path,{redirect:'manual',signal:AbortSignal.timeout(180000),...options,headers});
 const cookies=r.headers.getSetCookie().map(x=>x.split(';')[0]);if(cookies.length)jar.set(origin,cookies.join('; '));
 return r;
}
async function json(origin,path,method='GET',value){const r=await req(origin,path,{method,...(value?{headers:{origin,'content-type':'application/json'},body:JSON.stringify(value)}:{})});const data=await r.json();if(!r.ok)throw Error(`${method} ${path}: ${r.status} ${data.error||''}`);return data;}
async function main(){try{
 const bootstrap=await req(citizen,'/api/guest/bootstrap'),html=await bootstrap.text(),code=html.match(/name="code" value="([^"]+)"/)?.[1];if(!bootstrap.ok||!code)throw Error('Guest bootstrap failed');
 const receive=await req(staff,'/api/guest/receive',{method:'POST',headers:{origin:citizen,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code})});if(receive.status!==303)throw Error('Paired workspace handoff failed');report.checks.pairedGuestSession=true;
 for(const origin of [citizen,staff]){const r=await req(origin,'/');if(r.status!==200)throw Error('App page failed: '+origin);report.checks[origin===citizen?'citizenPage':'staffPage']=true;}
 const created=await json(citizen,'/api/complaints','POST',{title:'합성 검증: 쓰레기 수거와 배출 안내',body:'[가상 사례 · 기능 검증용] 청주시 가상공원 입구에 쓰레기가 쌓여 있습니다. 현장 수거를 요청합니다. 대형폐기물 배출 신고 방법도 알려 주세요. 실제 주소와 주민 개인정보가 없는 합성 민원입니다.',category:'생활폐기물',location:'청주시 가상공원 입구 — 합성 검증',occurredAt:'2026-11-07',consent:true,sample:true});id=created.id;report.caseId=id;report.checks.created=!!id;console.log('Synthetic case created',id);
 let c,last;
 for(let attempt=0;attempt<45;attempt++){
  c=(await json(staff,'/api/complaints/'+id)).complaint;report.checks.sharedStaffInbox=c.id===id;
  const state=c.auto_state+':'+c.auto_message;if(state!==last){report.transitions.push({at:new Date().toISOString(),state:c.auto_state,message:c.auto_message});console.log(c.auto_state,c.auto_message);last=state;}
  if(['completed','failed','blocked'].includes(c.auto_state))break;await new Promise(resolve=>setTimeout(resolve,10000));
 }
 if(c.auto_state!=='completed')throw Error('Automatic workflow not completed: '+c.auto_state);
 report.checks.automaticAnalysis=true;report.checks.coverageVersionCurrent=c.coverage_review?.version===expectedVersion;report.checks.matchingDraft=c.coverage_review?.draft===c.draft;report.checks.sentenceReviewCurrent=c.draft_review?.draft===c.draft;report.requirements=c.coverage_review?.requirements.map(x=>({text:x.text,responseStatus:x.responseStatus,summaryStatus:x.summaryStatus}));report.coverageVersion=c.coverage_review?.version;report.harnessRules=c.coverage_review?.harness?.decisions;report.checks.sourcePlanSaved=!!c.coverage_review?.harness?.plan;report.citations=c.evidence?.citations?.length||0;report.repair=c.coverage_review?.repair?{attempted:true,accepted:c.coverage_review.repair.accepted}:null;
 if(!report.checks.coverageVersionCurrent||!report.checks.matchingDraft||!report.checks.sentenceReviewCurrent||!report.requirements?.length||!report.checks.sourcePlanSaved||report.harnessRules?.length!==report.requirements.length)throw Error('Saved review mismatch');
 report.passed=true;
 }catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
 finally{if(id){try{const c=(await json(staff,'/api/complaints/'+id)).complaint;await json(staff,'/api/complaints/'+id,'PATCH',{action:'delete',revision:c.revision});report.checks.syntheticCaseRemoved=true;}catch(error){report.cleanupError=error.message;process.exitCode=1;}}report.finishedAt=new Date().toISOString();fs.writeFileSync(process.env.COVERAGE_SMOKE_OUT||'evals/results/coverage-production-harness-smoke.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));}}
await main();
