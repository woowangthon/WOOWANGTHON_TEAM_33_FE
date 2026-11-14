const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),{test}=require('node:test'),assert=require('node:assert/strict');
function harness(answer){const calls=[],cache=new Map();function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const out={};cache.set(file,out);new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name==='./structured-ai'?{structuredAI:async(_keys,name,_instructions,input)=>{calls.push({name,input});return answer(name,input);}}:name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name),out);return out;}return {...load('lib/semantic-search.ts'),calls};}
const source={title:'업무 확인 요청',body:'구간(북쪽)을 확인하고\n결과를 알려 주세요.',location:'',occurred_at:'',category:'기타'};
const good={kind:'requested_action',source:'body',quote:'확인하고\n결과를 알려 주세요.',value:'현장 확인 및 결과 안내 요청',essential:true};
const plan=facts=>({meaning:'현장 확인 요청',terms:['현장 확인'],sources:[],facts});
test('a mismatched source excerpt is repaired with the original source and checked again',async()=>{
 const h=harness(name=>name==='legal_search_plan'?plan([{...good,quote:'확인하고 결과를 알려 주세요.'}]):{facts:[good]});
 const out=await h.semanticPlan({},source);assert.equal(out.facts[0].quote,good.quote);assert.equal(out.facts[0].id,'F1');assert.equal(h.calls.length,2);
 assert.equal(h.calls[1].name,'grounded_fact_repair');assert.deepEqual(h.calls[1].input.invalidFactIndexes,[0]);assert.equal(h.calls[1].input.source.body,source.body);
});
test('a repair that still invents source text is rejected after the configured attempt',async()=>{
 const bad={...good,quote:'구간을 확인했다'};const h=harness(name=>name==='legal_search_plan'?plan([bad]):{facts:[bad]});
 await assert.rejects(h.semanticPlan({},source),/exact source evidence/);assert.equal(h.calls.length,2);
});
test('valid source facts need no repair and malformed fact types do not enter source recovery',async()=>{
 const valid=harness(()=>plan([good]));await valid.semanticPlan({},source);assert.equal(valid.calls.length,1);
 const invalid=harness(()=>plan([{...good,kind:'fabricated_kind'}]));await assert.rejects(invalid.semanticPlan({},source));assert.equal(invalid.calls.length,1);
});
