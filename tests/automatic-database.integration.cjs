// Real Postgres + real route/job code. Identity and external providers are test doubles.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {Pool}=require('pg');const prefix='automatic-test-'+crypto.randomUUID();const office=prefix+'-office';
let user={userId:prefix,email:'synthetic@example.invalid',isStaff:false};
let keys={gemini:'synthetic',law:'synthetic',model:'test'},calls=0,fail=false,hold=null;
let generatedDraft='자동 생성된 가상 답변 초안입니다.', lastGenerationArgs=[];
const callbacks=[];const cache=new Map();
const citation={id:'law:test:제1조',title:'검증용 가상 법령',article:'제1조',text:'테스트 전용 근거',sourceUrl:'https://www.law.go.kr',effectiveDate:'2020-01-01',jurisdiction:'전국',kind:'law'};
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const exports={};cache.set(file,exports);
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new Function('require','exports',js)(name=>{
  if(name.endsWith('/analysis-dispatch')||name==='./analysis-dispatch')return {startAnalysis:async(id)=>{callbacks.push(()=>jobs.processComplaint(id));}};if(name==='../../user')return {getCurrentUser:async()=>user};
  if(name==='next/server')return {after:fn=>callbacks.push(fn)};
  if(file.endsWith('automatic.ts')){
   if(name==='./access')return {...load('lib/access.ts'),OFFICE:office,officeForOwner:()=>office};
   if(name==='./review')return {verifyDraft:async(_key,_model,_provider,draft)=>({draft,status:'checked',validatorVersion:2,sentences:[{id:'S1',text:draft,status:'not_legal',reason:'가상 검토',references:[]}],checkedAt:new Date().toISOString()})};
   if(name==='./server')return {...load('lib/server.ts'),credentials:async()=>keys};
   if(name==='./laws')return {autoSync:async()=>[],retrieve:()=>({citations:[citation],warnings:[],mode:'test'})};
   if(name==='./ai')return {generateAnalysis:async(...args)=>{lastGenerationArgs=args;calls++;if(hold)await hold;if(fail)throw new Error('mock provider failure');return {summary:'테스트 요약',requests:['현장 확인'],questions:[],shieldLevel:'normal',shieldReason:'',sensitiveQuotes:[],actions:['현장 확인 준비'],draft:generatedDraft,citationIds:[citation.id],citations:[citation],warnings:[],generatedAt:new Date().toISOString(),model:'test',retrievalMode:'test'};}};
  }
  if(name.startsWith('.'))return load(path.resolve(path.dirname(file),name+'.ts'));return require(name);
 },exports);return exports;
}
const route=load('app/api/[...path]/route.ts'),jobs=load('lib/automatic.ts');const db=new Pool({connectionString:process.env.DATABASE_URL.replace('sslmode=require','sslmode=verify-full')});
db.on('error',()=>console.warn('Test database idle connection closed.'));
async function request(p,method='GET',body){const r=await route[method](new Request('https://test.invalid/api/'+p,{method,headers:{'Content-Type':'application/json',origin:'https://test.invalid'},...(body?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({path:p.split('/')})});return {status:r.status,data:await r.json()};}
async function get(id){return (await db.query('SELECT * FROM complaints WHERE id=$1',[id])).rows[0];}
async function submit(){process.env.SITE_MODE='citizen';const r=await request('complaints','POST',{title:'[자동 검증] 가상 민원 접수',body:'실제 기관과 무관한 자동 분석 흐름 검증입니다.',category:'생활폐기물',location:'청주시 테스트 장소',occurredAt:'2026-01-01',consent:true});assert.equal(r.status,201,JSON.stringify(r));return r.data.id;}
(async()=>{try{
 const id=await submit();assert.equal((await get(id)).auto_state,'queued');assert.equal(callbacks.length,1,'submission schedules server-side work');
 await Promise.all([callbacks.shift()(),jobs.processComplaint(id)]);let row=await get(id);
 assert.equal(calls,1,'concurrent jobs are deduplicated');assert.equal(row.auto_state,'completed');assert.equal(row.status,'reviewing');assert.equal(row.published,'');assert.ok(row.evidence);assert.ok(row.analysis);assert.equal(JSON.parse(row.draft_review).status,'checked');
 generatedDraft='새 근거가 반영된 가상 답변 초안입니다.';await jobs.queueAnalysis(id);await jobs.processComplaint(id);assert.equal((await get(id)).draft,generatedDraft,'untouched AI drafts update after reanalysis');
 keys={provider:'openai',openai:'synthetic-openai',gemini:'',law:'synthetic',model:'gpt-6-luna'};
 await jobs.queueAnalysis(id);await jobs.processComplaint(id);assert.equal((await get(id)).auto_state,'completed');assert.equal(lastGenerationArgs[0],'synthetic-openai');assert.equal(lastGenerationArgs[1],'gpt-6-luna');assert.equal(lastGenerationArgs[6],'openai');
 keys={gemini:'synthetic',law:'synthetic',model:'test'};
 let publicResult=await request('complaints/'+id);assert.equal(publicResult.data.complaint.draft,'');assert.equal(publicResult.data.complaint.auto_state,undefined);assert.equal(publicResult.data.complaint.auto_token,undefined);
 keys={...keys,gemini:'',law:''};const blocked=await submit();await callbacks.shift()();assert.equal((await get(blocked)).auto_state,'blocked');assert.equal((await get(blocked)).analysis,null);
 // Scope the resume query to these synthetic records; do not change other workspace rows.
 await db.query("UPDATE complaints SET auto_state='queued' WHERE id=$1 AND auto_state='blocked'",[blocked]);keys={...keys,gemini:'synthetic',law:'synthetic'};
 fail=true;await jobs.processComplaint(blocked);row=await get(blocked);assert.equal(row.auto_state,'failed');assert.ok(row.evidence,'evidence survives model failure');assert.equal(row.analysis,null);
 fail=false;await jobs.queueAnalysis(blocked);await jobs.processComplaint(blocked);assert.equal((await get(blocked)).auto_state,'completed');
 const edited=await submit();let release;hold=new Promise(resolve=>release=resolve);const currentCalls=calls;const job=callbacks.shift()();
 for(let i=0;i<100&&calls===currentCalls;i++)await new Promise(r=>setTimeout(r,50));assert.equal(calls,currentCalls+1);
 await db.query("UPDATE complaints SET draft='담당자가 작성한 비공개 초안입니다.',status='waiting',revision=revision+1 WHERE id=$1",[edited]);release();await job;hold=null;row=await get(edited);assert.equal(row.draft,'담당자가 작성한 비공개 초안입니다.');assert.equal(row.status,'waiting');assert.equal(row.published,'');
 const approved=await submit();hold=new Promise(resolve=>release=resolve);const before=calls;const lateJob=callbacks.shift()();for(let i=0;i<100&&calls===before;i++)await new Promise(r=>setTimeout(r,50));assert.equal(calls,before+1);
 await db.query("UPDATE complaints SET status='resolved',published='담당자가 승인한 답변입니다.',revision=revision+1 WHERE id=$1",[approved]);release();await lateJob;hold=null;row=await get(approved);assert.equal(row.status,'resolved');assert.equal(row.analysis,null);assert.equal(row.published,'담당자가 승인한 답변입니다.');
 console.log('PASS: submit → persisted queue → automatic analysis → private draft; duplicate leases, missing keys, provider failure/retry, staff-edit and approval protection. External providers mocked.');
 }finally{await db.query('DELETE FROM complaints WHERE owner=$1',[prefix]);await db.query('DELETE FROM limits WHERE id LIKE $1',[prefix+'%']);await db.end();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
