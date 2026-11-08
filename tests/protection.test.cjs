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
