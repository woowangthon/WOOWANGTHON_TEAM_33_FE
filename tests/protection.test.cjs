const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const ex={};new Function('exports',ts.transpileModule(fs.readFileSync('lib/protection.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(ex);
test('unreviewed titles are deferred without inventing classifications or changing evidence',()=>{
 const c={title:'씨발 집 앞 쓰레기 병신',body:'쓰레기를 치워주세요',analysis:null};
 assert.equal(ex.protectedTitle(c),'민원 분석 대기');assert.equal(c.title,'씨발 집 앞 쓰레기 병신');
 assert.deepEqual(ex.expressionFindings(c),[]);
 assert.equal(ex.protectedTitle({...c,analysis:{safeTitle:'주택 앞 쓰레기 수거 요청'}}),'주택 앞 쓰레기 수거 요청');
});
test('ordinary criticism, waste terms and homonyms are not keyword-labelled abusive',()=>{
 const text='처리가 늦어 불편합니다. 문제의 시발점을 확인하고 쓰레기를 수거해주세요.';
 assert.equal(ex.maskText(text),text);
});

test('context-reviewed animal and calendar terms remain visible without forced warnings',()=>{
 for(const text of ['새끼 고양이 구조 요청','병신년의 역사 자료 열람 요청','새끼손가락 부상 신고']){
  const c={title:text,body:text,analysis:{safeTitle:text,expressionFindings:[],sensitiveQuotes:[]}};
  assert.deepEqual(ex.expressionFindings(c),[]);
  assert.equal(ex.maskText(text),text);
  assert.equal(ex.protectedTitle(c),text);
 }
 assert.equal(ex.maskText('너 병신이냐'),'너 병신이냐');
});

test('only model findings establish labels and explicit spans control masking',()=>{
 const c={title:'너 병신이냐',body:'시 . 발 이 새끼야',analysis:{expressionFindings:[
  {kind:'insult',source:'title',quote:'너 병신이냐',reason:'상대를 비하함'},
  {kind:'insult',source:'body',quote:'이 새끼야',reason:'상대를 비하함'}
 ]}};
 const findings=ex.expressionFindings(c);
 assert.equal(findings.filter(f=>f.kind==='insult').length,2);
 assert.equal(findings.length,2);
 assert.equal(ex.maskText(c.title,findings.map(f=>f.quote)),'[보호된 표현]');
 const mixed='새끼 고양이를 구조해 주세요. 씨발';
 assert.equal(ex.maskText(mixed,['씨발']),'새끼 고양이를 구조해 주세요. [보호된 표현]');
});
test('expression evidence must exist in its stated title or body',()=>{
 const c={title:'집 앞 쓰레기',body:'왜 이렇게 처리가 늦습니까?',analysis:{expressionFindings:[
  {kind:'threat',source:'body',quote:'너를 죽이겠다',reason:'조작된 증거'},
  {kind:'criticism',source:'body',quote:'왜 이렇게 처리가 늦습니까?',reason:'처리 지연에 대한 업무 비판입니다.'},
 ]}};
 assert.deepEqual(ex.expressionFindings(c).map(f=>f.kind),['criticism']);
});

test('masking uses exact model-selected phrases without guessing suffixes',()=>{
 for(const text of ['씨발럼아','씨발놈들아','씨발새끼에게'])assert.equal(ex.maskText(text,[text]),'[보호된 표현]');
 assert.equal(ex.maskText('알파모욕어',['알파']),'[보호된 표현]모욕어');
 assert.equal(ex.protectedTitle({title:'씨발럼아',analysis:null}),'민원 분석 대기');
});
