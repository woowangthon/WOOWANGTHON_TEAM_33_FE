const citations={};new Function('exports',require('typescript').transpileModule(require('node:fs').readFileSync('lib/citations.ts','utf8'),{compilerOptions:{module:require('typescript').ModuleKind.CommonJS,target:require('typescript').ScriptTarget.ES2022}}).outputText)(citations);
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const review={};class AppError extends Error{}
new Function('require','exports',ts.transpileModule(fs.readFileSync('lib/review.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{if(name==='./citations')return citations;if(name==='./server')return {AppError,now:()=>new Date().toISOString()};throw Error(name);},review);
const source={id:'law:1:제1조',text:'시장은 해당 시설의 안전 상태를 확인할 수 있다.',title:'가상 검증법',article:'제1조',effectiveDate:'2020-01-01',jurisdiction:'전국',kind:'law',sourceUrl:'https://www.law.go.kr/'};
const draft='시설의 안전 상태를 확인할 수 있습니다. 【가상 검증법 제1조】';
const check=(overrides={})=>({id:'S1',status:'supported',reason:'원문 대조',references:[{citationId:source.id,quote:source.text}],...overrides});
test('trailing citation markers remain attached to their sentence without swallowing the next one',()=>{
 assert.deepEqual(review.draftSentences('확인할 수 있습니다.[law:1:제1조] 위치를 알려 주세요.').map(s=>s.text),['확인할 수 있습니다.[law:1:제1조]','위치를 알려 주세요.']);
});
test('sentence review validates exact source excerpts and refuses fabricated or unknown evidence',()=>{
 for(const references of [[{citationId:source.id,quote:'반드시 24시간 안에 모든 시설을 수리하여야 한다.'}],[{citationId:'law:unknown',quote:source.text}],[]]){
  const result=review.validateDraftReview(draft,[source],{checks:[check({references})]});assert.equal(result.sentences[0].status,'needs_review');assert.equal(review.reviewAllowsPublication(result,draft),false);
 }
 const result=review.validateDraftReview(draft,[source],{checks:[check()]});assert.equal(result.sentences[0].status,'supported');assert.equal(review.reviewAllowsPublication(result,draft),true);assert.equal(review.reviewAllowsPublication(result,draft+' 반드시 수리합니다.'),false);
});
test('omitted or duplicated sentences cannot disappear from review',()=>{
 const text='안녕하세요. 위치를 알려 주세요.';
 for(const checks of [[],[check({status:'not_legal',references:[]}),check({status:'not_legal',references:[]})]]){
  const result=review.validateDraftReview(text,[],{checks});assert.equal(result.sentences.length,2);assert.equal(result.sentences[1].status,'needs_review');assert.equal(review.reviewAllowsPublication(result,text),false);
 }
});
test('legal penalties cannot bypass evidence review as a greeting or an ordinary sentence',()=>{
 const text='과태료 100만원이 부과됩니다.';
 assert.equal(review.validateDraftReview(text,[],{checks:[check({status:'not_legal',references:[]})]}).sentences[0].status,'needs_review');
 assert.equal(review.validateDraftReview('확인했습니다. [law:unknown]',[],{checks:[check({status:'not_legal',references:[]})]}).sentences[0].status,'needs_review');
});
test('review transport fails closed on provider outage and uses supplied sources only',async()=>{
 const realFetch=global.fetch;
 try{
  global.fetch=async(_url,init)=>{const request=JSON.parse(init.body);assert.equal(request.store,false);assert.equal(request.text.format.strict,true);assert.deepEqual(JSON.parse(request.input).retrievedArticles,[source]);return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({checks:[check()]})}]}]});};
  assert.equal((await review.verifyDraft('synthetic','test','openai',draft,[source])).status,'checked');
  global.fetch=async()=>new Response('provider error',{status:429});await assert.rejects(review.verifyDraft('synthetic','test','openai',draft,[source]),/완료하지 못했습니다/);
 }finally{global.fetch=realFetch;}
});

test('a real quote from A cannot validate an inline citation to B',()=>{
 const second={...source,id:'law:2:제2조',title:'다른 검증법',article:'제2조'};
 for(const marker of ['[law:2:제2조]','【다른 검증법 제2조】']){
  const text='안전 상태를 확인할 수 있습니다. '+marker;
  const result=review.validateDraftReview(text,[source,second],{checks:[check()]});
  assert.equal(result.sentences.length,1);assert.equal(result.sentences[0].status,'needs_review');assert.equal(review.reviewAllowsPublication(result,text),false);
 }
});
test('legacy review versions and missing inline citations do not authorize publication',()=>{
 const result=review.validateDraftReview(draft,[source],{checks:[check()]});
 assert.equal(review.reviewAllowsPublication({...result,validatorVersion:undefined},draft),false);
 assert.equal(review.validateDraftReview('안전 상태를 확인할 수 있습니다.',[source],{checks:[check()]}).sentences[0].status,'needs_review');
});
