const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const ex={};new Function('exports',ts.transpileModule(fs.readFileSync('lib/protection.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(ex);
test('titles are masked before AI completes without altering original evidence',()=>{
 const c={title:'씨발 집 앞 쓰레기 병신',body:'쓰레기를 치워주세요',analysis:null};
 const title=ex.protectedTitle(c);assert.doesNotMatch(title,/씨발|병신/);assert.match(title,/집 앞 쓰레기/);assert.equal(c.title,'씨발 집 앞 쓰레기 병신');
 assert.equal(ex.expressionFindings(c).length,2);assert.ok(ex.expressionFindings(c).every(f=>f.source==='title'));
 assert.equal(ex.protectedTitle({...c,analysis:{safeTitle:'주택 앞 쓰레기 수거 요청'}}),'주택 앞 쓰레기 수거 요청');
});
test('ordinary criticism, waste terms and homonyms are not keyword-labelled abusive',()=>{
 const text='처리가 늦어 불편합니다. 문제의 시발점을 확인하고 쓰레기를 수거해주세요.';
 assert.equal(ex.maskText(text),text);assert.deepEqual(ex.profanityQuotes(text),[]);
});
test('expression evidence must exist in its stated title or body',()=>{
 const c={title:'집 앞 쓰레기',body:'왜 이렇게 처리가 늦습니까?',analysis:{expressionFindings:[
  {kind:'threat',source:'body',quote:'너를 죽이겠다',reason:'조작된 증거'},
  {kind:'criticism',source:'body',quote:'왜 이렇게 처리가 늦습니까?',reason:'처리 지연에 대한 업무 비판입니다.'},
 ]}};
 assert.deepEqual(ex.expressionFindings(c).map(f=>f.kind),['criticism']);
});

test('compound insults are masked in full including suffixes and old titles',()=>{
 for(const text of ['씨발럼아','씨발놈들아','씨발새끼에게'])assert.equal(ex.maskText(text),'[보호된 표현]');
 assert.equal(ex.protectedTitle({title:'씨발럼아',analysis:null}),'민원 내용 확인');
});

test('business summaries drop paraphrased disclosure threats and keep the service issue',()=>{
 const summary='골목에 대형 폐기물이 2주째 방치돼 있습니다. 이번 주 안에 수거되지 않으면 담당자 이름을 온라인에 공개하겠다고 밝혔습니다.';
 const c={title:'폐기물 수거 일정 확인',body:'가상 원문',analysis:{summary,safeTitle:'폐기물 수거 일정 확인',sensitiveQuotes:[],expressionFindings:[]}};
 assert.equal(ex.businessSummary(c),'골목에 대형 폐기물이 2주째 방치돼 있습니다.');assert.equal(c.analysis.summary,summary);
});
test('summary protection keeps reported safety issues but excludes insults and limits detail',()=>{
 const c={title:'안전한 현장 확인 요청',body:'씨발',analysis:{summary:'씨발 답답하다. 시설물이 떨어질 위험이 있습니다. 현장 점검을 요청합니다. 부가 설명입니다.',safeTitle:'현장 확인 요청',sensitiveQuotes:['씨발'],expressionFindings:[]}};
 assert.equal(ex.businessSummary(c),'시설물이 떨어질 위험이 있습니다. 현장 점검을 요청합니다.');
 c.analysis.summary='담당자를 죽이겠다고 합니다.';assert.equal(ex.businessSummary(c),'');
 c.analysis.summary='매우 긴 부가 설명 '.repeat(50);assert.ok(ex.businessSummary(c).length<=220);
});

test('verified victim reports are displayed intact without keyword deletion or title substitution',()=>{
 const summary='이웃의 협박 피해를 신고하고 보호 조치를 요청합니다.';
 const c={title:'보호 요청',body:'원문',analysis:{summary,summaryHarness:{status:'verified'}}};
 assert.equal(ex.businessSummary(c),summary);
});
