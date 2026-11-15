const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),{test}=require('node:test'),assert=require('node:assert/strict');
function harness(answer){const calls=[],cache=new Map();function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const out={};cache.set(file,out);new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name==='./structured-ai'?{structuredAI:async(_keys,name,_instructions,input)=>{calls.push({name,input});const value=answer(name,input);return name==='source_request_inventory'&&value&&!('candidateDecisions' in value)?{...value,candidateDecisions:input.candidateRequests.map((_,index)=>({index,decision:value.facts?.length?'represented':'not_request',requestIndices:value.facts?.length?[0]:[],reason:'Unit fixture candidate assessment'}))}:value;}}:name.startsWith('.')?load(path.resolve(path.dirname(file),name+'.ts')):require(name),out);return out;}return {...load('lib/semantic-search.ts'),calls};}
const source={title:'업무 확인 요청',body:'구간(북쪽)을 확인하고\n결과를 알려 주세요.',location:'',occurred_at:'',category:'기타'};
const good={kind:'requested_action',source:'body',quote:'확인하고\n결과를 알려 주세요.',value:'현장 확인 및 결과 안내 요청',essential:true,requestIntent:'action',conditions:[]};
const plan=facts=>({meaning:'현장 확인 요청',terms:['현장 확인'],sources:[],facts});
test('unique whitespace alignment copies the actual source span and records the proposed quote',async()=>{
 const h=harness(name=>name==='legal_search_plan'?plan([{...good,quote:'확인하고 결과를 알려 주세요.'}]):{facts:[good]});
 const out=await h.semanticPlan({},source);assert.equal(out.facts[0].quote,good.quote);assert.equal(out.facts[0].id,'F1');assert.equal(h.calls.length,2);
 assert.equal(out.quoteRepairs[0].proposedQuote,'확인하고 결과를 알려 주세요.');assert.equal(out.quoteRepairs[0].quote,good.quote);assert.ok(source.body.includes(out.quoteRepairs[0].quote));
});
test('a repair that still invents source text is rejected after the configured attempt',async()=>{
 const bad={...good,quote:'구간을 확인했다'};const h=harness(name=>name==='legal_search_plan'?plan([bad]):{facts:[bad]});
 await assert.rejects(h.semanticPlan({},source),/exact source evidence/);assert.equal(h.calls.length,2);
});
test('valid source facts need no repair and malformed fact types exhaust a bounded recovery',async()=>{
 const valid=harness(()=>plan([good]));await valid.semanticPlan({},source);assert.equal(valid.calls.length,2);
 const invalid=harness(()=>plan([{...good,kind:'fabricated_kind'}]));await assert.rejects(invalid.semanticPlan({},source));assert.equal(invalid.calls.length,2);
});
test('the request review reads the complete source and restores a request omitted by the plan',async()=>{
 const h=harness(name=>name==='legal_search_plan'?plan([]):name==='source_business_recheck'?{facts:[]}:{facts:[good]});
 const out=await h.semanticPlan({},source);assert.equal(out.facts.length,1);assert.equal(out.facts[0].requestIntent,'action');
 assert.equal(h.calls[2].name,'source_request_inventory');assert.deepEqual(Object.keys(h.calls[2].input),['source','candidateRequests']);assert.equal(h.calls[2].input.source.body,source.body);
});
test('a request inventory must retain typed requests and cannot replace them with background facts',async()=>{
 const h=harness(name=>name==='legal_search_plan'?plan([]):{facts:[{...good,kind:'problem',requestIntent:null}]});
 await assert.rejects(h.semanticPlan({},source),/Invalid source request inventory/);
});
test('non-whitespace source errors still use the bounded AI repair and literal recheck',async()=>{
 const h=harness(name=>name==='legal_search_plan'?plan([{...good,quote:'구간을 모두 수리했습니다.'}]):{facts:[good]});
 await h.semanticPlan({},source);assert.equal(h.calls[1].name,'grounded_fact_repair');assert.deepEqual(h.calls[1].input.invalidFactIndexes,[0]);assert.equal(h.calls.length,3);
});
test('the independent inventory cannot silently discard a request found by the first extraction',async()=>{
 const h=harness(name=>name==='legal_search_plan'?plan([good]):{facts:[],candidateDecisions:[]});await assert.rejects(h.semanticPlan({},source),/candidate accounting/);
});
test('missing request intent is repaired from source before generation, never filled with a default',async()=>{
 const malformed={...good,requestIntent:null};
 const h=harness(name=>name==='legal_search_plan'?plan([malformed]):{facts:[good]});
 const out=await h.semanticPlan({},source);
 assert.equal(out.facts[0].requestIntent,'action');assert.equal(h.calls[1].name,'grounded_fact_repair');
 assert.match(h.calls[1].input.validationIssues.join(' '),/intent and conditions/);
 assert.equal(out.validationRecoveries[0].response[0].requestIntent,null);
});
test('a candidate accounting error retries only the inventory with explicit feedback',async()=>{
 let inventories=0;
 const h=harness(name=>name==='legal_search_plan'?plan([good]):++inventories===1?{facts:[good],candidateDecisions:[]}:{facts:[good]});
 const out=await h.semanticPlan({},source);
 assert.equal(out.requestDecisions.length,1);assert.deepEqual(h.calls.map(c=>c.name),['legal_search_plan','source_request_inventory','source_request_inventory']);
 assert.match(h.calls[2].input.validationFeedback.issues.join(' '),/candidate accounting/);
});
test('an empty short topic extraction is rechecked without inventing an action request',async()=>{
 const c={...source,title:'도로 시설 설치 기준',body:'도로 시설 설치 기준에 관한 글입니다.'};
 const topic={kind:'problem',source:'title',quote:c.title,value:'도로 시설 설치 기준에 관한 내용',essential:true,requestIntent:null,conditions:[]};
 const h=harness(name=>name==='legal_search_plan'?plan([]):{facts:name==='source_business_recheck'?[topic]:[]});
 const out=await h.semanticPlan({},c);
 assert.equal(out.facts.length,1);assert.equal(out.facts[0].kind,'problem');assert.deepEqual(out.requestCandidates,[]);
});
test('an attack-only input remains empty after the recheck instead of becoming a canned summary fact',async()=>{
 const h=harness(name=>name==='legal_search_plan'?plan([]):{facts:[]});
 const out=await h.semanticPlan({},{...source,title:'불만',body:'너 정말 무능해.'});
 assert.deepEqual(out.facts,[]);assert.equal(h.calls.filter(c=>c.name==='source_business_recheck').length,1);
});
