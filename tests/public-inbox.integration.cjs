// Real route and Postgres, distinct browser identities; provider output and after() alone are mocked.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),{Pool}=require('pg');
const owners=['guest:'+crypto.randomUUID(),'guest:'+crypto.randomUUID()];let user=null,hold=null;
process.env.PUBLIC_STAFF_INBOX='true';const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{
  if(name.endsWith('/analysis-dispatch')||name==='./analysis-dispatch')return {startAnalysis:async()=>{}};if(name==='../../user')return {getCurrentUser:async()=>user};if(name==='next/server')return {after:()=>{}};
  if(name.endsWith('/coverage-ai'))return {auditRequirements:async(_keys,c)=>load('lib/coverage.ts').validateRequirementAudit(c,{requirements:[],noRequestReason:'가상 검증만 있으며 구체적인 행정 요구는 없습니다.'}),checkAnswerCoverage:async(_k,_c,a,d)=>load('lib/coverage.ts').validateCoverage(a,d,[],{checks:[]})};
  if(name.endsWith('/review')&&!file.endsWith('review.ts'))return {...load('lib/review.ts'),verifyDraft:async(_key,_model,_provider,draft,citations)=>{if(hold)await hold;const module=load('lib/review.ts');return module.validateDraftReview(draft,citations,{checks:module.draftSentences(draft).map(s=>({...s,status:'not_legal',reason:'가상 비법률 문장 검토',references:[]}))});}};
  if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name+'.ts'));return require(name);
 },exports);return exports;
}
const route=load('app/api/[...path]/route.ts'),db=new Pool({connectionString:process.env.DATABASE_URL.replace('sslmode=require','sslmode=verify-full')});
db.on('error',()=>{});
const identity=owner=>({userId:owner,isGuest:true,isStaff:true,email:'',fullName:'테스트 작업공간'});
async function request(p,method='GET',body){const r=await route[method](new Request('https://test.invalid/api/'+p,{method,headers:{'Content-Type':'application/json',origin:'https://test.invalid'},...(body?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({path:p.split('/')})});return {status:r.status,data:await r.json()};}
const get=async id=>(await request('complaints/'+id)).data.complaint;
(async()=>{try{
 user=identity(owners[0]);process.env.SITE_MODE='citizen';
 const submitted=await request('complaints','POST',{title:'[자동 검증] 브라우저 공유 민원',body:'실제 민원과 무관한 공유 접수함 검증 사례입니다.',category:'건축·주거',location:'청주시 가상 장소',occurredAt:'2026-01-01',consent:true});assert.equal(submitted.status,201);const id=submitted.data.id;
 user=identity(owners[1]);assert.equal((await request('complaints/'+id)).status,404);assert.equal((await request('overview')).data.complaints.some(c=>c.id===id),false,'citizen browser remains isolated');
 process.env.SITE_MODE='staff';let overview=await request('overview');assert.equal(overview.data.settings.publicInbox,true);assert.ok(overview.data.complaints.some(c=>c.id===id),'another staff browser sees same complaint');
 await db.query("UPDATE complaints SET auto_state='completed' WHERE id=$1",[id]);
 let c=await get(id),draft='안녕하세요. 정확한 위치를 알려 주세요.';
 assert.equal((await request('complaints/'+id,'PATCH',{action:'approve',draft,reviewed:true,revision:c.revision})).status,409);
 assert.equal((await request('complaints/'+id+'/verify-draft','POST',{draft,revision:c.revision})).status,200);c=await get(id);assert.equal(c.draft_review.status,'checked');
 assert.equal((await request('complaints/'+id,'PATCH',{action:'approve',draft:draft+' 즉시 처리하겠습니다.',reviewed:true,revision:c.revision})).status,409,'edited draft invalidates review');
 assert.equal((await request('complaints/'+id+'/verify-draft','POST',{draft,revision:c.revision-1})).status,409,'stale revisions rejected');
 const illegal='위반 시 과태료 100만원이 부과됩니다.';
 assert.equal((await request('complaints/'+id+'/verify-draft','POST',{draft:illegal,revision:c.revision})).status,200);c=await get(id);assert.equal(c.draft_review.sentences[0].status,'needs_review');
 assert.equal((await request('complaints/'+id,'PATCH',{action:'approve',draft:illegal,reviewed:true,revision:c.revision})).status,409);
 assert.equal((await request('complaints/'+id+'/verify-draft','POST',{draft,revision:c.revision})).status,200);c=await get(id);
 assert.equal((await request('complaints/'+id,'PATCH',{action:'approve',draft,reviewed:true,revision:c.revision})).status,200);
 user=identity(owners[0]);assert.equal((await get(id)).status,'resolved','another staff browser sees persisted changes');process.env.SITE_MODE='citizen';c=await get(id);assert.equal(c.published,draft);assert.equal(c.draft_review,null);assert.equal(c.draft,'');
 user=identity(owners[1]);assert.equal((await request('complaints/'+id)).status,404);
 process.env.SITE_MODE='staff';user={userId:'legacy-test-account',isGuest:false,isStaff:true};assert.equal((await request('complaints/'+id)).status,404);
 user=identity(owners[1]);c=await get(id);
 assert.equal((await request('complaints/'+id,'PATCH',{action:'delete',revision:c.revision-1})).status,409);
 assert.equal((await request('complaints/'+id,'PATCH',{action:'delete',revision:c.revision})).status,200);
 assert.equal((await request('complaints/'+id)).status,404);assert.equal((await request('overview')).data.complaints.some(c=>c.id===id),false);
 user=identity(owners[0]);process.env.SITE_MODE='citizen';assert.equal((await request('complaints/'+id)).status,404);assert.equal((await request('overview')).data.complaints.some(c=>c.id===id),false);
 assert.ok((await db.query('SELECT deleted_at FROM complaints WHERE id=$1',[id])).rows[0].deleted_at,'soft deletion retains recoverable record');
 console.log('PASS: public staff cross-browser inbox and reply; citizen isolation; draft review persists, stale/edited/unsupported approvals rejected. Synthetic rows cleaned.');
 }finally{for(const owner of owners){await db.query('DELETE FROM complaints WHERE owner=$1',[owner]);await db.query('DELETE FROM limits WHERE id LIKE $1',[owner+'%']);}await db.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
