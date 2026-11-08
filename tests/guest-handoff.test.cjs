const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');
const js=ts.transpileModule(fs.readFileSync('app/api/guest/[action]/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
test('browser handoff preserves Origin checking, uses a single-use POST code and sets a private session cookie',async()=>{
 const previous={SITE_MODE:process.env.SITE_MODE,CITIZEN_SITE_URL:process.env.CITIZEN_SITE_URL,STAFF_SITE_URL:process.env.STAFF_SITE_URL};
 Object.assign(process.env,{SITE_MODE:'citizen',CITIZEN_SITE_URL:'https://citizen.test',STAFF_SITE_URL:'https://staff.test'});
 let session=null,used=false;
 class AppError extends Error{constructor(message,status=400){super(message);this.status=status;}}
 const route={};new Function('require','exports',js)(name=>{
  if(name==='next/headers')return {cookies:async()=>({get:()=>({value:session?'cookie':undefined})})};
  if(name.endsWith('/guest'))return {guestCookie:'shield_workspace',guestMaxAge:7776000,guestIdentity:async()=>session,createGuestSession:async()=> 'synthetic-session',createTransfer:async()=> 'a'.repeat(64),consumeTransfer:async code=>{if(used||code!=='a'.repeat(64))return null;used=true;return 'guest:synthetic';}};
  if(name.endsWith('/server')&&name!=='next/server')return {AppError,rateLimit:async()=>{}};
  return require(name);
 },route);
 async function call(action,method='GET',headers={},body){return route[method](new Request('https://citizen.test/api/guest/'+action,{method,headers,...(body?{body}:{})}),{params:Promise.resolve({action})});}
 try{
  const start=await call('start');assert.equal(start.status,303);assert.equal(start.headers.get('location'),'https://staff.test/api/guest/bootstrap');
  const bootstrap=await call('bootstrap');assert.equal(bootstrap.status,200);assert.equal(bootstrap.headers.get('referrer-policy'),'strict-origin');assert.match(bootstrap.headers.get('set-cookie'),/HttpOnly/i);assert.match(bootstrap.headers.get('set-cookie'),/Secure/i);
  const html=await bootstrap.text();assert.match(html,/method="post"/);assert.match(html,/action="https:\/\/staff.test\/api\/guest\/receive"/);assert.doesNotMatch(html,/content="no-referrer"/);assert.match(bootstrap.headers.get('content-security-policy'),/form-action https:\/\/staff.test/);
  assert.equal((await call('receive','POST',{origin:'https://evil.test'},'code='+'a'.repeat(64))).status,403);assert.equal(used,false);
  const receive=await call('receive','POST',{origin:'https://staff.test'},'code='+'a'.repeat(64));assert.equal(receive.status,303);assert.equal(receive.headers.get('location'),'https://citizen.test/');assert.ok(receive.headers.get('set-cookie'));
  assert.equal((await call('receive','POST',{origin:'https://staff.test'},'code='+'a'.repeat(64))).status,400);
  session={userId:'guest:synthetic'};assert.equal((await call('switch','GET',{'sec-fetch-site':'cross-site'})).status,403);assert.equal((await call('switch','GET',{'sec-fetch-site':'same-origin'})).status,200);
 }finally{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
