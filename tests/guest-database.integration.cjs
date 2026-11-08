// Real DB and route code. Only the request identity and after() scheduler are stubbed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {Pool}=require('pg');
const owners=['guest:'+crypto.randomUUID(),'guest:'+crypto.randomUUID()];
let user=null;const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',js)(name=>{
  if(name.endsWith('/analysis-dispatch')||name==='./analysis-dispatch')return {startAnalysis:async()=>{}};if(name==='../../user')return {getCurrentUser:async()=>user};
  if(name==='next/server')return {after:()=>{}};
  if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name+'.ts'));
  return require(name);
 },exports);return exports;
}
const guest=load('lib/guest.ts'),route=load('app/api/[...path]/route.ts'),server=load('lib/server.ts'),jobs=load('lib/automatic.ts');
const db=new Pool({connectionString:process.env.DATABASE_URL.replace('sslmode=require','sslmode=verify-full')});
async function request(p,method='GET',input){const r=await route[method](new Request('https://test.invalid/api/'+p,{method,headers:{'Content-Type':'application/json',origin:'https://test.invalid'},...(input?{body:JSON.stringify(input)}:{})}),{params:Promise.resolve({path:p.split('/')})});return {status:r.status,data:await r.json()};}
const idFor=owner=>({userId:owner,isGuest:true,isStaff:true,email:'',fullName:'작업공간'});
const oldMode=process.env.SITE_MODE,oldGemini=process.env.GEMINI_API_KEY,oldLaw=process.env.LAW_API_OC;
const managedNames=['PUBLIC_STAFF_INBOX','SERVICE_GEMINI_API_KEY','SERVICE_OPENAI_API_KEY','SERVICE_LAW_API_OC'];
const managedPrevious=Object.fromEntries(managedNames.map(k=>[k,process.env[k]]));
for(const key of managedNames)delete process.env[key];
(async()=>{try{
 const cookie=await guest.createGuestSession(owners[0]);assert.equal((await guest.guestIdentity(cookie)).userId,owners[0]);assert.equal(await guest.guestIdentity(cookie.slice(1)),null);assert.equal(await guest.guestIdentity('0'.repeat(64)),null);
 const code=await guest.createTransfer(owners[0],'https://citizen.test','https://staff.test');
 assert.equal(await guest.consumeTransfer(code,'https://evil.test','https://staff.test'),null);
 assert.equal(await guest.consumeTransfer(code,'https://citizen.test','https://evil.test'),null);
 assert.equal(await guest.consumeTransfer(code,'https://citizen.test','https://staff.test'),owners[0]);
 assert.equal(await guest.consumeTransfer(code,'https://citizen.test','https://staff.test'),null,'transfer codes cannot replay');
 const expired=await guest.createTransfer(owners[0],'https://citizen.test','https://staff.test');await db.query('UPDATE guest_transfers SET expires_at=NOW()-INTERVAL \'1 minute\' WHERE owner=$1',[owners[0]]);
 assert.equal(await guest.consumeTransfer(expired,'https://citizen.test','https://staff.test'),null);
 process.env.GEMINI_API_KEY='synthetic-private-default';process.env.LAW_API_OC='synthetic-private-default';
 assert.equal((await server.credentials(owners[0])).gemini,'');assert.equal((await server.credentials(owners[0])).law,'','guest workspaces do not inherit private API credentials');
 process.env.SITE_MODE='citizen';user=idFor(owners[0]);
 const r=await request('complaints','POST',{title:'[자동 검증] 비회원 민원',body:'개인정보 없는 테스트 민원입니다. 가상 현장 확인을 요청합니다.',category:'생활폐기물',location:'청주시 테스트 장소',occurredAt:'2026-01-01',consent:true});assert.equal(r.status,201);const id=r.data.id;
 assert.equal((await request('complaints/'+id,'PATCH',{action:'status',status:'waiting',revision:0})).status,403);
 process.env.SITE_MODE='staff';user=idFor(owners[1]);assert.equal((await request('complaints/'+id)).status,404);assert.equal((await request('overview')).data.complaints.length,0);
 user=idFor(owners[0]);let overview=await request('overview');assert.deepEqual(overview.data.complaints.map(c=>c.id),[id]);assert.equal(overview.data.settings.geminiReady,false);
 assert.ok((await request('complaints/'+id)).data.events.some(event=>event.label==='홈페이지 민원 접수'));
 await jobs.processComplaint(id);assert.equal((await request('complaints/'+id)).data.complaint.auto_state,'blocked');
 const saved=await request('complaints/'+id,'PATCH',{action:'save',draft:'비회원 담당자 화면에서 작성한 가상 답변입니다.',revision:0});assert.equal(saved.status,200);
 const reviewedDraft='비회원 담당자 화면에서 검토한 가상 답변입니다.';
 await db.query('UPDATE complaints SET draft_review=$1 WHERE id=$2',[JSON.stringify({draft:reviewedDraft,status:'checked',validatorVersion:2,sentences:[{id:'S1',text:reviewedDraft,status:'not_legal',reason:'테스트 검증',references:[]}]}),id]);
 const current=(await request('complaints/'+id)).data.complaint,coverageModule=load('lib/coverage.ts');
 await db.query('UPDATE complaints SET coverage_review=$1 WHERE id=$2',[JSON.stringify({version:1,draft:reviewedDraft,sourceSnapshot:coverageModule.sourceSnapshot(current),analysisSnapshot:coverageModule.analysisSnapshot(current),requirements:[],noRequestReason:'가상 테스트용 담당자 확인',checkedAt:new Date().toISOString()}),id]);
 const approval=await request('complaints/'+id,'PATCH',{action:'approve',draft:reviewedDraft,reviewed:true,revision:1});assert.equal(approval.status,200);
 process.env.SITE_MODE='citizen';const result=await request('complaints/'+id);assert.equal(result.data.complaint.status,'resolved');assert.match(result.data.complaint.published,/검토한/);assert.equal(result.data.complaint.draft,'');assert.equal(result.data.complaint.analysis,null);
 process.env.SITE_MODE='staff';user={userId:'synthetic-account-staff',isGuest:false,isStaff:true,email:''};assert.equal((await request('complaints/'+id)).status,404,'legacy account staff cannot access a guest workspace');
 console.log('PASS: guest session, invalid/expired/replayed transfer rejection, workspace separation, private key isolation, citizen submission → staff reply → citizen result with no account.');
 }finally{
  for(const owner of owners){await db.query('DELETE FROM complaints WHERE owner=$1',[owner]);await db.query('DELETE FROM limits WHERE id LIKE $1',[owner+'%']);await db.query('DELETE FROM guest_sessions WHERE owner=$1',[owner]);await db.query('DELETE FROM guest_transfers WHERE owner=$1',[owner]);}
  for(const [key,value] of [['SITE_MODE',oldMode],['GEMINI_API_KEY',oldGemini],['LAW_API_OC',oldLaw]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  for(const [key,value] of Object.entries(managedPrevious)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  await db.end();
 }
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
