const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
function compile(file,imports){const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(imports,out);return out;}
const access=compile('lib/access.ts',require);
class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}}
let user=null;const queries=[];
const route=compile('app/api/[...path]/route.ts',name=>{
 if(name==='zod')return require('zod');
 if(name==='../../user')return{getCurrentUser:async()=>user};
 if(name.endsWith('/access'))return access;
 if(name.endsWith('/types'))return{categories:['기타'],statuses:{}};
 if(name.endsWith('/server'))return{AppError,database:()=>({prepare:sql=>({bind:(...values)=>({run:async()=>{queries.push({sql,values});return{meta:{changes:1}};}})})})};
 return{};
});
const id='SS-123456789ABC';
async function request(ids=[id],origin='https://test.invalid'){
 return route.DELETE(new Request('https://test.invalid/api/complaints/trash',{method:'DELETE',headers:{'Content-Type':'application/json',origin},body:JSON.stringify({ids})}),{params:Promise.resolve({path:['complaints','trash']})});
}
test('trash purge enforces authentication, staff role, same origin and bounded identifiers',async()=>{
 process.env.SITE_MODE='staff';process.env.PUBLIC_STAFF_INBOX='false';
 user=null;assert.equal((await request()).status,401);
 user={userId:'guest:one',isGuest:true,isStaff:false};assert.equal((await request()).status,403);
 user={...user,isStaff:true};assert.equal((await request([id],'https://other.invalid')).status,403);
 assert.equal((await request([])).status,400);assert.equal((await request(['invalid'])).status,400);assert.equal((await request(Array(201).fill(id))).status,400);
 assert.equal(queries.length,0);
});
test('private guest purge targets only explicit IDs in its own trash',async()=>{
 process.env.SITE_MODE='staff';process.env.PUBLIC_STAFF_INBOX='false';user={userId:'guest:one',isGuest:true,isStaff:true};
 const r=await request([id,id]);assert.equal(r.status,200);assert.deepEqual(await r.json(),{deleted:1});
 const q=queries.at(-1);assert.match(q.sql,/WHERE \(owner=\?\) AND deleted_at IS NOT NULL AND id IN \(\?\)/);assert.deepEqual(q.values,['guest:one',id]);
});
test('shared guest and staff inbox purges retain office isolation and trash guard',async()=>{
 process.env.PUBLIC_STAFF_INBOX='true';user={userId:'guest:one',isGuest:true,isStaff:true};await request();
 assert.match(queries.at(-1).sql,/owner LIKE 'guest:%'/);assert.deepEqual(queries.at(-1).values,[id]);
 user={userId:'officer',isGuest:false,isStaff:true};await request();
 assert.match(queries.at(-1).sql,/owner NOT LIKE 'guest:%'/);assert.match(queries.at(-1).sql,/deleted_at IS NOT NULL/);assert.deepEqual(queries.at(-1).values,[id]);
});
