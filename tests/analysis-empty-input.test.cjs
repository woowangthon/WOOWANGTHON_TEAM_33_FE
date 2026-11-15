const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
const root=path.resolve(process.env.REPAIR_SOURCE_ROOT||'.');
function harness(answer){
 const cache=new Map(),calls=[],writes=[];
 class AppError extends Error{constructor(message,status=400,retryable=true){super(message);this.status=status;this.retryable=retryable;}}
 const source={title:'확인',body:'ㅇㅇㅇㅇㅇㅇㅇㅇㅇㅇ',location:'',occurred_at:'2026-11-05',category:'기타',supplements:[],tasks:[]};
 const server={AppError,now:()=> 'now',rateLimit:async()=>{},credentials:async()=>({openai:'test',law:'test',model:'test'}),decodeComplaint:()=>source,database:()=>({prepare:sql=>({bind:(...values)=>({first:async()=>({owner:'guest:test',analysis_checkpoint:null}),run:async()=>{writes.push({sql,values});return {meta:{changes:1}};}})})})};
 const overrides={'lib/server.ts':server,'lib/structured-ai.ts':{structuredAI:async(_keys,name,_prompt,input)=>{calls.push(name);return answer(name,input);}},'lib/laws.ts':{},'lib/ai.ts':{},'lib/reply-harness.ts':{}};
 function load(file){file=path.resolve(root,file);const rel=path.relative(root,file).replaceAll('\\','/');if(overrides[rel])return overrides[rel];if(cache.has(file))return cache.get(file);const out={};cache.set(file,out);new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>n.startsWith('.')?load(path.resolve(path.dirname(file),n+'.ts')):require(n),out);return out;}
 return {load,source,calls,writes,server};
}
const date={kind:'time',source:'occurred_at',quote:'2026-11-05',value:'2026년 11월 5일',essential:false,requestIntent:null,conditions:[]};
const plan={meaning:'업무 내용 확인 불가',terms:[],sources:[],facts:[date]};
test('a date-only extraction is valid evidence but is not a business problem',()=>{
 const h=harness(),m=h.load('lib/summary-harness.ts');
 const facts=m.groundFacts([date],h.source);assert.equal(facts.length,1);assert.equal(m.hasBusinessFacts(facts),false);
 assert.throws(()=>m.groundFacts([{...date,kind:'problem'}],h.source),/core business/);
});
test('context-only input gets a source recheck without inventing a summary or request',async()=>{
 const h=harness(name=>name==='legal_search_plan'?plan:{facts:[],candidateDecisions:[]});
 const result=await h.load('lib/semantic-search.ts').semanticPlan({},h.source);
 assert.deepEqual(result.facts,[]);assert.deepEqual(h.calls,['legal_search_plan','source_business_recheck','source_request_inventory']);
});
test('a source recheck can recover genuine business content from a partial extraction',async()=>{
 const problem={...date,kind:'problem',source:'body',quote:'가로등이 꺼져 있습니다.',value:'가로등 고장',essential:true};
 const h=harness(name=>name==='legal_search_plan'?plan:{facts:name==='source_business_recheck'?[problem]:[],candidateDecisions:[]});h.source.body=problem.quote;
 const result=await h.load('lib/semantic-search.ts').semanticPlan({},h.source);
 assert.equal(result.facts[0].kind,'problem');assert.equal(result.facts[0].quote,problem.quote);
});
test('missing business content stops before retrieval, remains failed and preserves the receipt',async()=>{
 const h=harness(name=>name==='legal_search_plan'?plan:{facts:[],candidateDecisions:[]});
 const stage=h.load('lib/analysis-stages.ts'),summary=h.load('lib/summary-harness.ts');
 await assert.rejects(stage.runAnalysisStage('test',0,'plan'),e=>e.retryable===false&&e.status===422&&e.message===summary.missingBusinessContentMessage);
 await stage.failAnalysis('test',0,false,true);
 const failure=h.writes.find(w=>w.sql.includes("auto_state='failed'"));
 assert.equal(failure.values[0],summary.missingBusinessContentMessage);
 assert.match(failure.sql,/auto_state!='completed'/);assert.ok(h.writes.every(w=>!w.sql.includes('DELETE')&&!w.sql.includes('SET analysis=')));
});
test('workflow preserves the content problem instead of retrying it as an outage',async()=>{
 const h=harness(),summary=h.load('lib/summary-harness.ts'),failures=[];let attempts=0;
 class FatalError extends Error{};class RetryableError extends Error{};
 const stubs={'workflow':{FatalError,RetryableError},'../lib/analysis-messages':h.load('lib/analysis-messages.ts'),'../lib/summary-harness':summary,'../lib/analysis-stages':{runAnalysisStage:async()=>{attempts++;throw new h.server.AppError(summary.missingBusinessContentMessage,422,false);},failAnalysis:async(...args)=>failures.push(args)}};
 const out={};new Function('require','exports',ts.transpileModule(fs.readFileSync(path.join(root,'workflows/analyze-complaint.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>stubs[n],out);
 assert.deepEqual(await out.analyzeComplaint('test',0),{completed:false});assert.equal(attempts,1);assert.deepEqual(failures,[['test',0,false,true]]);
});
