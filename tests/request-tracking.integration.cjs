// Real PostgreSQL and API handlers, synthetic owners; model/workflow transport is stubbed.
const fs=require('fs'),path=require('path'),ts=require('typescript'),assert=require('node:assert/strict'),{Pool}=require('pg');
const owners=['guest:'+crypto.randomUUID(),'guest:'+crypto.randomUUID()];let user={userId:owners[0],isGuest:true,isStaff:true},dispatches=0;
process.env.PUBLIC_STAFF_INBOX='true';process.env.SITE_MODE='citizen';const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const e={};cache.set(file,e);new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>{
 if(n==='../../user')return {getCurrentUser:async()=>user};if(n==='next/server')return {after:()=>{}};if(n.endsWith('analysis-dispatch'))return {startAnalysis:async()=>{dispatches++;}};
 return n.startsWith('.')?load(path.resolve(path.dirname(file),n+'.ts')):require(n);
},e);return e;}
const route=load('app/api/[...path]/route.ts'),coverage=load('lib/coverage.ts');
const u=new URL(process.env.DATABASE_URL);u.searchParams.set('sslmode','verify-full');const db=new Pool({connectionString:u.toString()});db.on('error',()=>{});
const report={synthetic:true,method:'Real DB/API; provider and workflow dispatch mocked. No AI accuracy claim.',checks:{}};
async function req(p,method='GET',body){const r=await route[method](new Request('https://test.invalid/api/'+p,{method,headers:{origin:'https://test.invalid','content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({path:p.split('/')})});return {status:r.status,data:await r.json()};}
const get=async id=>(await req('complaints/'+id)).data.complaint;
const post=(id,body)=>req(`complaints/${id}/requirements`,'POST',body);
(async()=>{try{
 const made=await req('complaints','POST',{title:'[합성 검증] 요구별 처리 흐름',body:'쓰레기 수거를 요청합니다. 처리 일정을 알려 주세요. 재발 방지 대책도 알려 주세요.',category:'생활폐기물',location:'청주시 가상 장소',occurredAt:'2026-11-07',consent:true});assert.equal(made.status,201);const id=made.data.id;
 const analysis={summary:'쓰레기 수거와 일정, 재발 방지',requests:['쓰레기 수거 요청','처리 일정 안내','재발 방지 대책 안내'],sensitiveQuotes:[],draft:'초안입니다.'};
 await db.query("UPDATE complaints SET analysis=$1,auto_state='completed' WHERE id=$2",[JSON.stringify(analysis),id]);
 let c=await get(id),original=c.body;assert.equal(c.analysis,null);assert.equal(c.request_tracking.items.length,3);report.checks.citizenSeesRequestsWithoutInternalDraft=true;
 const rows=c.request_tracking.items.map(r=>({id:r.id,text:r.id==='Q2'?'월요일 수거 일정 안내':r.text,withdrawn:r.id==='Q3'}));rows.push({text:'수거 담당 부서 연락처 안내',withdrawn:false});
 const firstRevision=c.revision;assert.equal((await post(id,{action:'confirm',revision:c.revision,items:rows})).status,200);
 assert.equal((await post(id,{action:'confirm',revision:firstRevision,items:rows})).status,409);c=await get(id);assert.equal(c.body,original);assert.equal(c.request_tracking.items[1].originalText,'처리 일정 안내');assert.equal(c.request_tracking.items[2].withdrawn,true);report.checks.originalAndHistoryPreserved=true;
 user.userId=owners[1];assert.equal((await req('complaints/'+id)).status,404);assert.equal((await post(id,{action:'reply',revision:c.revision,id:'Q1',text:'다른 시민 답변'})).status,404);user.userId=owners[0];assert.equal((await post(id,{action:'progress',revision:c.revision,id:'Q1',state:'completed',note:'권한 없는 완료 처리'})).status,403);report.checks.citizenIsolationAndStaffOnlyProgress=true;
 process.env.SITE_MODE='staff';user.userId=owners[1];assert.equal((await post(id,{action:'confirm',revision:c.revision,items:rows})).status,403);
 assert.equal((await post(id,{action:'progress',revision:c.revision,id:'Q1',state:'completed',note:''})).status,400);
 const race=await Promise.all([post(id,{action:'progress',revision:c.revision,id:'Q1',state:'waiting',note:'수거할 위치의 상세 주소를 알려 주세요.'}),post(id,{action:'progress',revision:c.revision,id:'Q1',state:'waiting',note:'수거 지점을 구체적으로 알려 주세요.'})]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);report.checks.staleAndConcurrentWritesRejected=true;
 c=await get(id);process.env.SITE_MODE='citizen';user.userId=owners[0];assert.equal((await post(id,{action:'reply',revision:c.revision,id:'Q1',text:'가상로 15 앞입니다.'})).status,200);c=await get(id);assert.equal(c.request_tracking.items[0].state,'received');assert.equal(c.supplements.at(-1).role,'citizen');report.checks.targetedReplyReopensAndQueuesAnalysis=dispatches>=3;
 process.env.SITE_MODE='staff';user.userId=owners[1];c=await get(id);const draft='가상 확인 결과와 안내를 등록합니다.';
 const active=c.request_tracking.items.filter(r=>!r.withdrawn);const audit=coverage.validateRequirementAudit(c,{requirements:active.map(r=>({text:r.text,source:'request:'+r.id,quote:r.text,summaryStatus:'preserved',summaryReason:'합성 검증'})),noRequestReason:''});
 const review=coverage.validateCoverage(audit,draft,[{id:'S1',text:draft}],{checks:audit.requirements.map(r=>({id:r.id,status:'answered',sentenceIds:['S1'],reason:'합성 검증',evidenceQuotes:[{sentenceId:'S1',quote:draft}]}))});
 const legal={validatorVersion:2,draft,status:'checked',sentences:[{id:'S1',text:draft,status:'not_legal',reason:'가상 연결 검증',references:[]}],checkedAt:new Date().toISOString()};
 await db.query("UPDATE complaints SET auto_state='completed',draft=$1,coverage_review=$2,draft_review=$3 WHERE id=$4",[draft,JSON.stringify(review),JSON.stringify(legal),id]);
 assert.equal((await req('complaints/'+id,'PATCH',{action:'approve',revision:c.revision,draft,reviewed:true})).status,200);c=await get(id);assert.equal(c.status,'resolved');assert.ok(c.request_tracking.items.every(r=>r.state==='received'));report.checks.answerPublicationNeverCompletesRequests=true;
 assert.equal((await post(id,{action:'progress',revision:c.revision,id:'Q1',state:'completed',note:'합성 검증: 현장 수거 결과를 기록했습니다.'})).status,200);c=await get(id);assert.equal(c.request_tracking.items[0].state,'completed');assert.equal(c.request_tracking.items[1].state,'received');report.checks.explicitResultCompletesOnlySelectedRequest=true;
 process.env.SITE_MODE='citizen';user.userId=owners[0];const revised=c.request_tracking.items.map(r=>({id:r.id,text:r.id==='Q1'?'기존 위치 외에 가상로 16 앞의 수거도 요청':r.text,withdrawn:r.withdrawn}));assert.equal((await post(id,{action:'confirm',revision:c.revision,items:revised})).status,200);c=await get(id);assert.equal(c.request_tracking.items[0].state,'received');assert.equal(c.status,'reviewing');
 process.env.SITE_MODE='staff';c=await get(id);assert.equal(c.draft_review,null);assert.equal(c.coverage_review,null);assert.equal(c.body,original);report.checks.editAfterCompletionReopensAndInvalidatesReview=true;
 assert.equal((await req('complaints/'+id,'PATCH',{action:'delete',revision:c.revision})).status,200);assert.equal((await post(id,{action:'progress',revision:c.revision+1,id:'Q1',state:'completed',note:'삭제 후 변경 시도'})).status,404);report.checks.deletedCaseCannotMutate=true;
 report.passed=true;
 }catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}
 finally{for(const owner of owners){await db.query('DELETE FROM complaints WHERE owner=$1',[owner]);await db.query('DELETE FROM limits WHERE id LIKE $1',[owner+'%']);}await db.end();report.finishedAt=new Date().toISOString();fs.writeFileSync('evals/results/request-tracking-integration.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
})().catch(e=>{console.error(e.code||e.name);process.exitCode=1;});
