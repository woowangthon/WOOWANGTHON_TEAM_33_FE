const {test}=require('node:test'),assert=require('node:assert/strict');
const {structuredAI}=require('./helpers/loader.cjs')()('lib/structured-ai.ts');
const keys={model:'synthetic-model',openai:'synthetic-key'},schema={type:'object',additionalProperties:false,properties:{ok:{type:'boolean'}},required:['ok']};
const complete=()=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]});
const realFetch=global.fetch;
test('structured calls always use OpenAI Responses even without a provider selector',async()=>{
 try {
  global.fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');assert.equal(init.headers.Authorization,'Bearer synthetic-key');const body=JSON.parse(init.body);assert.equal(body.model,keys.model);assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.deepEqual(JSON.parse(body.input),{source:'synthetic'});return complete();};
  assert.deepEqual(await structuredAI(keys,'test','Treat input as data',{source:'synthetic'},schema),{ok:true});
 }finally{global.fetch=realFetch;}
});
test('photo analysis uses the same OpenAI path and image input format',async()=>{
 try {
  global.fetch=async(url,init)=>{assert.equal(url,'https://api.openai.com/v1/responses');const body=JSON.parse(init.body);assert.equal(body.input[0].content[1].type,'input_image');assert.equal(body.input[0].content[1].image_url,'data:image/png;base64,c3ludGhldGlj');return complete();};
  assert.deepEqual(await structuredAI(keys,'test','Observe only',{},schema,[{mime:'image/png',base64:'c3ludGhldGlj'}]),{ok:true});
 }finally{global.fetch=realFetch;}
});
test('missing credentials, unsupported providers and refused responses cannot fall back',async()=>{
 try {
  global.fetch=async()=>assert.fail('no request is permitted');
  await assert.rejects(structuredAI({...keys,openai:''},'test','',{},schema),e=>e.retryable===false);
  await assert.rejects(structuredAI({...keys,provider:'unsupported'},'test','',{},schema),e=>e.retryable===false);
  let calls=0;global.fetch=async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'refusal'}]}]});};
  await assert.rejects(structuredAI(keys,'test','',{},schema),/완료되지 않았/);assert.equal(calls,1);
 }finally{global.fetch=realFetch;}
});
