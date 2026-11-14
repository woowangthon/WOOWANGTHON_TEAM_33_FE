const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const {createElement}=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const component={};
new Function('require','exports',ts.transpileModule(fs.readFileSync('app/supplement-panel.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText)(require,component);
test('unreviewed citizen supplements are collapsed for staff and remain available in original form',()=>{
 const c={id:'synthetic',status:'resolved',supplements:[{id:'s1',role:'citizen',text:'검토 전 원문 <script>',createdAt:'2026-11-14T00:00:00Z',attachments:[]}]};
 const render=staff=>renderToStaticMarkup(createElement(component.default,{complaint:c,staff,onChanged:()=>{}}));
 const staff=render(true),citizen=render(false);
 assert.match(staff,/<details><summary>추가 답변 원문 보기/);assert.doesNotMatch(staff,/<details[^>]*open/);
 assert.match(staff,/검토 전 원문 &lt;script&gt;/);assert.doesNotMatch(citizen,/<details/);assert.match(citizen,/검토 전 원문 &lt;script&gt;/);
});
