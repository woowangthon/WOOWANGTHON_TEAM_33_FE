const fs=require('node:fs'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const load=require('../evals/loader.cjs')();
function render(selected=false){
 const failed={id:'SS-SYNTHETIC',title:'합성 보도 점검 요청',body:'보도를 점검해 주세요.',location:'가상 장소',category:'기타',created_at:'2026-11-14T00:00:00Z',status:'received',auto_state:'failed',analysis:null,tasks:[],revision:1};
 const pending={...failed,id:'SS-PENDING',title:'표시되면 안 되는 처리 중 민원',auto_state:'processing'};
 const source=fs.readFileSync('app/staff-workspace.tsx','utf8'),out={};let state=0;
 const stubs={
  'react':{...React,useState:initial=>{const i=state++;return React.useState(i===0?{complaints:[failed,pending],settings:{},user:{name:''}}:i===2&&selected?failed:i===4?false:initial);}},
  '../lib/protection':load('lib/protection.ts'),'../lib/complaint-notifications':load('lib/complaint-notifications.ts'),'../lib/types':load('lib/types.ts'),
  './phone-desk':{default:()=>null},'./sai-mark':{default:()=>null},'./workspace':{ComplaintDetail:()=>React.createElement('p',null,'원문 탭 제공')}
 };
 new Function('require','exports',ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name in stubs?stubs[name]:require(name),out);
 return renderToStaticMarkup(React.createElement(out.default,{authenticated:true,otherSiteUrl:'https://example.invalid'}));
}
test('a failed complaint remains selectable in the inbox without a failure popup or a request list',()=>{
 const html=render();assert.match(html,/합성 보도 점검 요청/);assert.match(html,/AI 요약 실패 · 원문 확인 필요/);
 assert.doesNotMatch(html,/표시되면 안 되는 처리 중 민원|자동 분석을 완료하지 못했습니다|요청사항 목록/);
});
test('the failed detail retains its individual retry action',()=>{
 const html=render(true);assert.match(html,/>재시도<\/button>/);assert.match(html,/원문 탭 제공/);
});
