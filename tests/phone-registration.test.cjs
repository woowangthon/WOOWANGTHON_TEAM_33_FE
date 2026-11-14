const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const ts=require('typescript');const {createHmac}=require('node:crypto');
const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync('lib/phone-registration.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(require,out);
const sign=body=>createHmac('sha256','secret').update(body).digest('hex');
test('runtime registration rejects forgery, expired requests, SSRF, redirects and credentials',()=>{
 const now=Date.now();const body=JSON.stringify({endpoint:'https://demo-name.trycloudflare.com',issuedAt:now});
 assert.equal(out.registeredPhoneEndpoint(body,sign(body),'secret',now),'https://demo-name.trycloudflare.com');
 assert.equal(out.registeredPhoneEndpoint(body,sign(body),'wrong',now),null);
 assert.equal(out.registeredPhoneEndpoint(body,sign(body),'secret',now+121000),null);
 for(const endpoint of ['http://127.0.0.1','https://127.0.0.1','https://demo.trycloudflare.com.evil.test','https://demo.trycloudflare.com/path','https://user:pass@demo.trycloudflare.com','https://demo.trycloudflare.com?x=1']){
  const request=JSON.stringify({endpoint,issuedAt:now});assert.equal(out.registeredPhoneEndpoint(request,sign(request),'secret',now),null);
 }
});
