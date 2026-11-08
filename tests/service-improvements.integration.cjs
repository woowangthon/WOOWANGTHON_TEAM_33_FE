// Real database, synthetic owners, deterministic provider transport. No customer rows modified.
const fs=require('fs'),path=require('path'),ts=require('typescript'),assert=require('node:assert/strict'),{Pool}=require('pg');
const owners=['guest:'+crypto.randomUUID(),'guest:'+crypto.randomUUID()];let user={userId:owners[0],isGuest:true,isStaff:true},calls={plan:0,evidence:0,analysis:0,review:0},failOnce=true;
process.env.PUBLIC_STAFF_INBOX='true';process.env.SITE_MODE='citizen';const cache=new Map();
const citation={id:'law:999:제1조',title:'가상 검증법',article:'제1조',text:'현장 상태를 확인할 수 있는 가상 검증용 조문입니다.',effectiveDate:'2020-01-01',kind:'law',jurisdiction:'전국',sourceUrl:'https://www.law.go.kr/'};
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const e={};cache.set(file,e);new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>{
 if(n==='../../user')return {getCurrentUser:async()=>user};if(n==='next/server')return {after:()=>{}};
 if(n.endsWith('analysis-dispatch'))return {startAnalysis:async()=>{}};
 if(file.endsWith('analysis-stages.ts')){
  if(n==='./server')return {...load('lib/server.ts'),credentials:async()=>({provider:'openai',openai:'synthetic',law:'synthetic',model:'test'})};
  if(n==='./semantic-search')return {semanticPlan:async()=>{calls.plan++;return {profiles:[],terms:[],sources:[]};},rerank:async(_k,_c,cs)=>cs};
  if(n==='./laws')return {autoSync:async()=>{calls.evidence++;return [];},retrieve:()=>({citations:[citation],warnings:[],mode:'test'})};
  if(n==='./ai')return {generateAnalysis:async(_k,_m,c)=>{calls.analysis++;if(failOnce){failOnce=false;throw Error('transient synthetic failure');}assert.match(c.body,/추가 위치/);return {safeTitle:'검증 민원',summary:'검증',requests:[],questions:[],actions:[],draft:'안녕하세요. 위치를 확인해 주세요.',citations:[citation],citationIds:[citation.id]};}};
  if(n==='./review')return {verifyDraft:async(_k,_m,_p,draft)=>{calls.review++;return {validatorVersion:2,draft,status:'checked',sentences:[{id:'S1',text:draft,status:'not_legal',reason:'',references:[]}]};}};
  if(n==='./structured-ai')return {structuredAI:async()=>({observations:'가상 사진'})};
  if(n==='./coverage-ai')return {auditRequirements:async(_keys,c)=>load('lib/coverage.ts').validateRequirementAudit(c,{requirements:[],noRequestReason:'가상 검증만 있으며 구체적인 행정 요구는 없습니다.'}),checkAnswerCoverage:async(_k,_c,a,d)=>load('lib/coverage.ts').validateCoverage(a,d,[],{checks:[]})};
 }
 return n.startsWith('.')?load(path.resolve(path.dirname(file),n+'.ts')):require(n);
},e);return e;}
const route=load('app/api/[...path]/route.ts'),stages=load('lib/analysis-stages.ts'),db=new Pool({connectionString:process.env.DATABASE_URL.replace('sslmode=require','sslmode=verify-full')});db.on('error',()=>{});
async function req(p,method='GET',body){const multipart=body instanceof FormData;const r=await route[method](new Request('https://test.invalid/api/'+p,{method,headers:{origin:'https://test.invalid',...(multipart?{}:{'Content-Type':'application/json'})},...(body?{body:multipart?body:JSON.stringify(body)}:{})}),{params:Promise.resolve({path:p.split('?')[0].split('/')})});return {status:r.status,data:r.headers.get('content-type')?.includes('application/json')?await r.json():await r.arrayBuffer()};}
const get=async(id,trash=false)=>(await req('complaints/'+id+(trash?'?trash=1':''))).data.complaint;
(async()=>{try{
 const created=await req('complaints','POST',{title:'[가상 검증] 보완 흐름',body:'실제 민원과 무관한 보완 및 복구 기능 검증입니다.',category:'기타',location:'청주시 가상 장소',occurredAt:'2020-06-01',consent:true});assert.equal(created.status,201);const id=created.data.id;
 process.env.SITE_MODE='staff';user.userId=owners[1];let c=await get(id);
 assert.equal((await req('complaints/'+id+'/supplements','POST',{text:'정확한 위치를 알려 주세요.',revision:c.revision})).status,201);c=await get(id);assert.equal(c.status,'waiting');
 assert.equal((await req('complaints/'+id+'/supplements','POST',{text:'중복 요청',revision:c.revision-1})).status,409);
 process.env.SITE_MODE='citizen';const form=new FormData();form.set('text','추가 위치는 가상길 10번지 앞입니다.');form.set('revision',String(c.revision));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jW1QAAAAASUVORK5CYII=','base64');form.append('photos',new Blob([png],{type:'image/png'}),'synthetic.png');
 assert.equal((await req('complaints/'+id+'/supplements','POST',form)).status,404,'another citizen cannot answer');user.userId=owners[0];
 assert.equal((await req('complaints/'+id+'/supplements','POST',form)).status,201);c=await get(id);assert.equal(c.status,'reviewing');assert.equal(c.supplements.length,2);const photo=c.supplements[1].attachments[0];assert.equal((await req(`complaints/${id}/attachments/${photo.id}`)).status,200);
 user.userId=owners[1];assert.equal((await req(`complaints/${id}/attachments/${photo.id}`)).status,404);process.env.SITE_MODE='staff';assert.equal((await req(`complaints/${id}/attachments/${photo.id}`)).status,200);
 const gen=(await db.query('SELECT analysis_generation FROM complaints WHERE id=$1',[id])).rows[0].analysis_generation;
 await stages.runAnalysisStage(id,gen,'plan');await stages.runAnalysisStage(id,gen,'evidence');await assert.rejects(stages.runAnalysisStage(id,gen,'analysis'));
 await stages.runAnalysisStage(id,gen,'plan');await stages.runAnalysisStage(id,gen,'evidence');await stages.runAnalysisStage(id,gen,'analysis');await stages.runAnalysisStage(id,gen,'review');
 await stages.runAnalysisStage(id,gen,'requirements');await stages.runAnalysisStage(id,gen,'coverage');
 await db.query('UPDATE complaints SET draft=$1,revision=revision+1 WHERE id=$2',['담당자가 직접 수정한 초안을 보존합니다.',id]);
 await stages.runAnalysisStage(id,gen,'finish');c=await get(id);assert.equal(c.auto_state,'completed');assert.equal(c.draft,'담당자가 직접 수정한 초안을 보존합니다.');assert.equal(c.draft_review,null);assert.deepEqual(calls,{plan:1,evidence:1,analysis:2,review:1});
 assert.equal((await req('complaints/'+id,'PATCH',{action:'delete',revision:c.revision})).status,200);assert.equal(await stages.runAnalysisStage(id,gen,'finish'),false);assert.equal((await req('complaints/'+id)).status,404);
 c=await get(id,true);assert.ok(c.deleted_at);assert.ok((await req('overview')).data.trashComplaints.some(c=>c.id===id));
 assert.equal((await req('complaints/'+id,'PATCH',{action:'restore',revision:c.revision})).status,200);c=await get(id);assert.equal(c.deleted_at,null);assert.equal(c.supplements.length,2);assert.equal((await req(`complaints/${id}/attachments/${photo.id}`)).status,200);
 console.log('PASS: supplement request/reply/photo isolation, shared trash/restore, durable checkpoints resume only failed stage, concurrent staff edits and deleted generations preserved.');
 }finally{for(const owner of owners){await db.query('DELETE FROM complaints WHERE owner=$1',[owner]);await db.query('DELETE FROM limits WHERE id LIKE $1',[owner+'%']);}await db.end();}
})().catch(e=>{console.error(e.name,e.message,e.stack?.split('\n').slice(1,3).join('\n'));process.exitCode=1;});
