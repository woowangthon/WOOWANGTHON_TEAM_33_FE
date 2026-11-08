// Real Neon database with synthetic test owners; only the session provider is stubbed.
// Run explicitly with: node --env-file=.env.local tests/api-database.integration.cjs
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');const {Pool}=require('pg');
let user=null;const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','exports',js)(name=>{if(name.endsWith('/analysis-dispatch')||name==='./analysis-dispatch')return {startAnalysis:async()=>{}};if(name==='../../user')return {getCurrentUser:async()=>user};if(name==='next/server')return {after:()=>{}};if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name+'.ts'));return require(name);},exports);return exports;}
const route=load('app/api/[...path]/route.ts');const prefix='integration-'+crypto.randomUUID();const citizen={userId:prefix+'-citizen',email:prefix+'@example.invalid',isStaff:false};const officer={userId:prefix+'-officer',email:prefix+'-officer@example.invalid',isStaff:true};
const sql=new Pool({connectionString:process.env.DATABASE_URL});
async function request(p,method='GET',body){const response=await route[method](new Request('https://test.invalid/api/'+p,{method,headers:{'Content-Type':'application/json',origin:'https://test.invalid'},...(body?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({path:p.split('/')})});return {status:response.status,data:await response.json()};}
(async()=>{try{
 process.env.SITE_MODE='citizen';assert.equal((await request('overview')).status,401);
 user=citizen;let r=await request('complaints','POST',{title:'[자동 검증] 가상 쓰레기 민원',body:'테스트용 가상 장소의 폐기물 현장 확인을 요청합니다.',category:'생활폐기물',location:'청주시 가상 테스트 장소',occurredAt:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()),consent:true});assert.equal(r.status,201,JSON.stringify(r));const id=r.data.id;
 assert.equal((await request('complaints/'+id)).status,200);
 assert.equal((await request('complaints/'+id,'PATCH',{revision:0,action:'approve',reviewed:true,draft:'허용되지 않는 테스트 답변입니다.'})).status,403);
 user={...citizen,userId:prefix+'-stranger'};assert.equal((await request('complaints/'+id)).status,404);
 process.env.SITE_MODE='staff';assert.equal((await request('overview')).status,403);
 user=officer;assert.equal((await request('complaints/'+id)).status,200);
 r=await request('complaints/'+id,'PATCH',{revision:0,action:'save',draft:'담당자가 확인 중인 비공개 초안입니다.'});assert.equal(r.status,200);
 assert.equal((await request('complaints/'+id,'PATCH',{revision:0,action:'status',status:'waiting'})).status,409);
 process.env.SITE_MODE='citizen';user=citizen;r=await request('complaints/'+id);assert.equal(r.data.complaint.draft,'');assert.equal(r.data.complaint.published,'');
 process.env.SITE_MODE='staff';user=officer;
 const reviewedDraft='가상 검증 결과입니다. 확인 후 안내드립니다.';
 assert.equal((await request('complaints/'+id,'PATCH',{revision:1,action:'approve',reviewed:true,draft:reviewedDraft})).status,409,'unverified drafts cannot be published');
 await sql.query("UPDATE complaints SET draft_review=$1,auto_state='completed' WHERE id=$2",[JSON.stringify({draft:reviewedDraft,status:'checked',validatorVersion:2,sentences:[{id:'S1',text:reviewedDraft,status:'not_legal',reason:'테스트 검증',references:[]}]}),id]);
 const current=(await request('complaints/'+id)).data.complaint,coverageModule=load('lib/coverage.ts');
 assert.equal((await request('complaints/'+id,'PATCH',{revision:1,action:'approve',reviewed:true,draft:reviewedDraft})).status,409,'legal review alone does not satisfy requirement coverage');
 await sql.query('UPDATE complaints SET coverage_review=$1 WHERE id=$2',[JSON.stringify({version:1,draft:reviewedDraft,sourceSnapshot:coverageModule.sourceSnapshot(current),analysisSnapshot:coverageModule.analysisSnapshot(current),requirements:[],noRequestReason:'가상 테스트용 담당자 확인',checkedAt:new Date().toISOString()}),id]);
 r=await request('complaints/'+id,'PATCH',{revision:1,action:'approve',reviewed:true,draft:reviewedDraft});assert.equal(r.status,200);
 process.env.SITE_MODE='citizen';user=citizen;r=await request('complaints/'+id);assert.equal(r.data.complaint.status,'resolved');assert.equal(r.data.complaint.published,'가상 검증 결과입니다. 확인 후 안내드립니다.');assert.equal(r.data.complaint.draft,'');
 console.log('PASS: real DB create/read, citizen isolation, staff-only access, optimistic locking, approval and citizen final response (session provider stubbed).');
}finally{await sql.query('DELETE FROM complaints WHERE owner = $1',[citizen.userId]);await sql.query('DELETE FROM limits WHERE id LIKE $1',[prefix+'%']);await sql.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
