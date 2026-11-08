const fs=require('fs'),path=require('path'),ts=require('typescript'),assert=require('node:assert/strict'),{Pool}=require('pg');
const owners=['guest:'+crypto.randomUUID(),'guest:'+crypto.randomUUID()];let user={userId:owners[0],isGuest:true,isStaff:true};
process.env.PUBLIC_STAFF_INBOX='true';process.env.SITE_MODE='citizen';const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const out={};cache.set(file,out);new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{
 if(name==='../../user')return {getCurrentUser:async()=>user};if(name==='next/server')return {after:()=>{}};if(name.endsWith('analysis-dispatch'))return {startAnalysis:async()=>{}};
 if(name.endsWith('coverage-ai'))return {auditRequirements:async(_k,c)=>load('lib/coverage.ts').validateRequirementAudit(c,{requirements:[{text:'쓰레기 수거',source:'body',quote:'쓰레기를 수거해 주세요.',summaryStatus:'preserved',summaryReason:'반영'},{text:'일정 안내',source:'body',quote:'일정을 알려 주세요.',summaryStatus:c.analysis.requests.includes('일정 안내')?'preserved':'missing',summaryReason:'확인'}],noRequestReason:''}),checkAnswerCoverage:async(_k,_c,a,d)=>load('lib/coverage.ts').validateCoverage(a,d,load('lib/review.ts').draftSentences(d),{checks:[{id:'R1',status:'clarification',reason:'위치 질문',sentenceIds:['S1'],evidenceQuotes:[{sentenceId:'S1',quote:'수거할 정확한 위치를 알려 주세요.'}],informationNeeded:'상세 위치',dependencyReason:'수거 대상을 특정하는 데 필요',alreadyProvided:false,generalAnswerPossible:false},{id:'R2',status:'missing',reason:'일정 누락',sentenceIds:[]}]})};
 if(name.endsWith('/review')&&!file.endsWith('review.ts'))return {...load('lib/review.ts'),verifyDraft:async(_k,_m,_p,d,cs)=>{const m=load('lib/review.ts');return m.validateDraftReview(d,cs,{checks:m.draftSentences(d).map(s=>({id:s.id,status:'not_legal',reason:'가상 문장 검증',references:[]}))});}};
 if(file.endsWith('reports.ts')&&name==='./structured-ai')return {structuredAI:async()=>({personalStrings:['김가상']})};
 return name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name);
},out);return out;}
const route=load('app/api/[...path]/route.ts'),db=new Pool({connectionString:process.env.DATABASE_URL.replace('sslmode=require','sslmode=verify-full')});
async function req(p,method='GET',input){const r=await route[method](new Request('https://test.invalid/api/'+p,{method,headers:{origin:'https://test.invalid','Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})}),{params:Promise.resolve({path:p.split('/')})});return {status:r.status,data:r.headers.get('content-type')?.startsWith('application/json')?await r.json():await r.text(),headers:r.headers};}
const get=async id=>(await req('complaints/'+id)).data.complaint;
(async()=>{try{
 const body='쓰레기를 수거해 주세요. 일정을 알려 주세요. 야한 얘기나 하자. 성명: 김가상 전화 010-0000-0000 <script>alert(1)</script>';
 const created=await req('complaints','POST',{title:'[합성 테스트] 요구 대응',body,category:'생활폐기물',location:'청주시 가상 장소',occurredAt:'2026-10-30',consent:true});assert.equal(created.status,201);const id=created.data.id;
 const analysis={safeTitle:'가상 수거 민원',summary:'수거 요청',requests:['쓰레기 수거'],sensitiveQuotes:['야한 얘기나 하자.'],expressionFindings:[{kind:'sexual_harassment',source:'body',quote:'야한 얘기나 하자.',reason:'원치 않는 성적인 대화 요구'}],citations:[]};
 const draft='수거할 정확한 위치를 알려 주세요. 일정을 확인하기 위해 해당 위치가 필요합니다.';
 analysis.draft=draft;
 await db.query("UPDATE complaints SET analysis=$1,draft=$2,auto_state='completed' WHERE id=$3",[JSON.stringify(analysis),draft,id]);process.env.SITE_MODE='staff';user.userId=owners[1];let c=await get(id);
 assert.equal((await req(`complaints/${id}/verify-draft`,'POST',{draft,revision:c.revision})).status,200);c=await get(id);assert.equal(c.coverage_review.requirements.length,2);
 assert.equal((await req(`complaints/${id}`,'PATCH',{action:'approve',draft,reviewed:true,revision:c.revision})).status,409,'summary and answer omissions block publication');
 const decision=(value,reason)=>req(`complaints/${id}/coverage-decision`,'POST',{draft,revision:c.revision,requestId:'R2',decision:value,reason});
 assert.equal((await decision('include','원문 일정 요구 확인')).status,200);c=await get(id);assert.ok(c.analysis.requests.includes('일정 안내'));
 assert.equal((await req(`complaints/${id}`,'PATCH',{action:'approve',draft,reviewed:true,revision:c.revision})).status,409,'remaining answer omission still blocks');
 assert.equal((await decision('clarification','두 번째 문장에서 일정을 위해 필요한 위치를 구체적으로 질문함')).status,200);c=await get(id);assert.equal(c.coverage_review.requirements[1].responseStatus,'missing');assert.equal(c.coverage_review.requirements[1].override.responseStatus,'clarification');
 assert.equal((await req(`complaints/${id}`,'PATCH',{action:'approve',draft:draft+' 내용 변경.',reviewed:true,revision:c.revision})).status,409,'editing invalidates both checks');
 const report=await req(`complaints/${id}/reports`,'POST',{revision:c.revision,note:'김가상 010-0000-0000 <script>attack</script>',confirmed:['F1']});assert.equal(report.status,201,JSON.stringify(report.data));assert.equal(report.data.report.findings[0].staffConfirmed,true);assert.ok(!JSON.stringify(report.data).includes('010-0000-0000'));assert.ok(!JSON.stringify(report.data).includes('김가상'));
 const reportId=report.data.report.id,download=await req(`complaints/${id}/reports/${reportId}`);assert.equal(download.status,200);assert.match(download.headers.get('content-disposition'),/attachment/);assert.equal(download.data.includes('<script>'),false);assert.match(download.data,/성희롱 의심/);
 assert.equal((await req(`complaints/${id}/reports`,'POST',{revision:c.revision-1,note:'',confirmed:[]})).status,409);
 assert.equal((await req(`complaints/${id}`,'PATCH',{action:'approve',draft,reviewed:true,revision:c.revision})).status,200);
 process.env.SITE_MODE='citizen';user.userId=owners[0];c=await get(id);assert.equal(c.coverage_review,null);assert.equal((await req(`complaints/${id}/reports/${reportId}`)).status,403);assert.equal(c.body,body,'original evidence preserved');user.userId=owners[1];assert.equal((await req(`complaints/${id}`)).status,404);
 console.log('PASS: two-stage publication guard, source correction, reasoned human override, edited/stale rejection, masked report snapshot/download, XSS escaping, citizen isolation, originals unchanged.');
}finally{for(const owner of owners){await db.query('DELETE FROM complaints WHERE owner=$1',[owner]);await db.query('DELETE FROM limits WHERE id LIKE $1',[owner+'%']);}await db.end();}})().catch(e=>{console.error(e.message,e.stack?.split('\n').slice(1,3).join('\n'));process.exitCode=1;});
