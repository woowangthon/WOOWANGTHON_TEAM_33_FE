const fs=require('fs'),path=require('path'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
const actual=require('../evals/loader.cjs')(),coverage=actual('lib/coverage.ts');
function harness({accepted=true,legacy=false}={}){
 const c={id:'test',title:'현장 확인',body:'현장을 확인해 주세요.',location:'가상동',category:'기타',occurred_at:'2026-11-07',supplements:[],analysis:{summary:'현장 확인',requests:['현장 확인'],draft:'검토하겠습니다.',citationIds:[],citations:[],sensitiveQuotes:[]}};
 const audit=coverage.validateRequirementAudit(c,{requirements:[{text:'현장 확인',source:'body',quote:c.body,summaryStatus:'preserved',summaryReason:'반영'}],noRequestReason:''});
 const initial=coverage.validateCoverage(audit,c.analysis.draft,[{id:'S1',text:c.analysis.draft}],{checks:[{id:'R1',status:'missing',reason:'구체적 질문 없음',sentenceIds:[]}]});
 const cp={analysis:c.analysis,requirements:legacy?{...audit,sourceSnapshot:'old'}:audit,evidence:{citations:[],warnings:[]},review:{draft:c.analysis.draft},...(legacy?{coverage:{...initial,version:1}}:{})},row={owner:'guest:test',analysis_checkpoint:JSON.stringify(cp)};
 const calls={audit:0,check:0,repair:0,verify:[],saved:null};
 const stubs={
 './server':{AppError:class extends Error{},database:()=>({prepare:sql=>({bind:(...values)=>({first:async()=>row,run:async()=>{if(sql.includes('SET analysis_checkpoint='))calls.saved=JSON.parse(values[0]);return {meta:{changes:1}};}})})}),credentials:async()=>({provider:'openai',openai:'mock',law:'mock',model:'mock'}),decodeComplaint:()=>c,now:()=>new Date().toISOString()},
 './access':{officeForOwner:()=> 'office:test'},'./laws':{},'./semantic-search':{},'./ai':{},'./structured-ai':{},
 './coverage-ai':{auditRequirements:async()=>{calls.audit++;return audit;},checkAnswerCoverage:async()=>{calls.check++;return initial;}},
 './coverage-repair':{repairAnswerCoverage:async()=>{calls.repair++;return {...initial,draft:accepted?initial.draft+'\n\n대상 시설의 상세 위치를 알려 주세요.':initial.draft,repair:{attempted:true,accepted,originalDraft:initial.draft,beforeMissing:1,afterMissing:accepted?0:1}};}},
 './review':{verifyDraft:async(_k,_m,_p,draft)=>{calls.verify.push(draft);return {draft,status:'checked'};}},
 './coverage':coverage,'./citations':actual('lib/citations.ts'),'./request-tracking':actual('lib/request-tracking.ts')
 };
 const e={};new Function('require','exports',ts.transpileModule(fs.readFileSync('lib/analysis-stages.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(n=>stubs[n]||require(n),e);
 return {run:()=>e.runAnalysisStage('test',1,'coverage'),calls,c};
}
test('accepted completion revalidates sentence evidence and stores matching draft/review',async()=>{const h=harness();await h.run();assert.equal(h.calls.verify.length,1);assert.equal(h.calls.saved.analysis.draft,h.calls.saved.coverage.draft);assert.equal(h.calls.saved.review.draft,h.calls.saved.analysis.draft);});
test('rejected completion preserves original draft and its sentence review',async()=>{const h=harness({accepted:false});await h.run();assert.equal(h.calls.verify.length,0);assert.equal(h.calls.saved.analysis.draft,h.c.analysis.draft);assert.equal(h.calls.saved.review.draft,h.c.analysis.draft);});
test('retrying a legacy checkpoint refreshes its audit instead of reusing old coverage',async()=>{const h=harness({legacy:true});await h.run();assert.equal(h.calls.audit,1);assert.equal(h.calls.check,1);assert.equal(h.calls.saved.coverage.version,actual('lib/coverage-policy.ts').COVERAGE_VERSION);});
