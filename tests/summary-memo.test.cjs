const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {renderToStaticMarkup}=require('react-dom/server'),{createElement}=require('react');
const memo=require('../evals/loader.cjs')()('lib/summary-memo.ts');
const component={};
new Function('require','exports',ts.transpileModule(fs.readFileSync('app/summary-memo.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(name=>name==='../lib/summary-memo'?memo:require(name),component);
const render=summary=>renderToStaticMarkup(createElement(component.default,{summary}));

test('fact memo retains contact history and renders only supplied labels as definition rows',()=>{
 const summary='현황: 2주째 적치\n경과: 전화 문의 3회, 현장 방문 없음\n위치: 가상길 골목\n피해:   ';
 const rows=memo.parseSummaryMemo(summary);
 assert.deepEqual(rows.map(r=>r.label),['위치','현황','경과']);
 assert.equal(rows[2].value,'전화 문의 3회, 현장 방문 없음');
 const html=render(summary);assert.match(html,/<dl /);assert.equal((html.match(/<dt>/g)||[]).length,3);assert.doesNotMatch(html,/<dt>피해/);
});

test('legacy, mixed and repeated-label summaries preserve all text rather than silently hiding facts',()=>{
 for(const summary of ['민원인은 전화 문의를 세 차례 했으나 조치가 없었다고 설명합니다.','위치: 가상길\n기존 전화 문의 3회','현황: 적치\n현황: 보행 방해']){
  assert.equal(memo.parseSummaryMemo(summary),null);const html=render(summary);
  assert.match(html,/<p /);assert.ok(html.includes(summary));
 }
});

test('empty memo has no blank box and citizen text is rendered as text',()=>{
 assert.equal(render(' \n '),'');
 const html=render('대상: <img src=x onerror=alert(1)>');
 assert.doesNotMatch(html,/<img /);assert.match(html,/&lt;img/);
});
