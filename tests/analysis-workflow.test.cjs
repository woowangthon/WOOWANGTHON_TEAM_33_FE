const fs=require('node:fs'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
function harness({draft='',conflict=false,missing=false}={}){
 const analysis={summary:'합성 요약',requests:['기존 내부 분석'],draft:'합성 민원에 대한 답변 초안입니다.',actions:[]};
 const c={id:'test',revision:2,title:'합성 민원',body:'현장을 확인해 주세요.',supplements:[],tasks:[],draft,analysis:null,status:'reviewing',request_tracking:{confirmedAt:'old',items:[{text:'과거 수정 사항',withdrawn:false}]}};
 const row={owner:'guest:test',analysis_checkpoint:JSON.stringify({analysis,evidence:{citations:[],warnings:[]}})},writes=[];
 const stubs={
  './server':{database:()=>({prepare:sql=>({bind:(...values)=>({first:async()=>missing?null:row,run:async()=>{writes.push({sql,values});return {meta:{changes:conflict&&sql.includes('SET evidence=')?0:1}};}})})}),credentials:async()=>({provider:'openai',openai:'synthetic',law:'synthetic'}),decodeComplaint:()=>c,now:()=> 'now'},
  './access':{officeForOwner:()=> 'office:test'},'./laws':{},'./semantic-search':{},'./ai':{},'./structured-ai':{}
 };
 const e={};new Function('require','exports',ts.transpileModule(fs.readFileSync('lib/analysis-stages.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>{assert.ok(n in stubs,'Unexpected dependency '+n);return stubs[n];},e);
 return {...e,writes,c,analysis,run:stage=>e.runAnalysisStage('test',1,stage)};
}
test('analysis completes without retired check results or creating a request list',async()=>{
 const h=harness();assert.equal(await h.run('finish'),true);
 const save=h.writes.find(w=>w.sql.includes('SET evidence='));assert.equal(save.values[2],h.analysis.draft);
 assert.match(save.sql,/draft_review=NULL,coverage_review=NULL/);assert.doesNotMatch(save.sql,/request_tracking=/);
});
test('analysis completion preserves a staff edit and rejects concurrent writes',async()=>{
 const h=harness({draft:'담당자가 직접 수정한 초안'});await h.run('finish');assert.equal(h.writes.find(w=>w.sql.includes('SET evidence=')).values[2],h.c.draft);
 await assert.rejects(harness({conflict:true}).run('finish'),/Concurrent staff edit/);
 assert.equal(await harness({missing:true}).run('finish'),false);
});
test('old workflows skip retired stages without external calls or database writes',async()=>{
 const h=harness();for(const stage of ['requirements','review','coverage'])assert.equal(await h.run(stage),true);assert.deepEqual(h.writes,[]);
});
test('existing citizen corrections remain context when reanalyzing historical records',()=>{
 const h=harness();assert.match(h.supplementedComplaint(h.c).body,/과거 수정 사항/);
});
