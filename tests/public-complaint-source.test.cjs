const {test}=require('node:test'),assert=require('node:assert/strict');
const {extract,text}=require('../evals/public-complaints/collect.cjs');
const sources=require('../evals/public-complaints/sources.json');
test('public complaint extraction excludes findings and decisions from the model input',()=>{
 const html='<h4>신청원인</h4><ul><li>공개된 민원 내용입니다. 도로 소음이 심하니 방음벽 보완을 요청합니다.<br/>이미 있는 표현만 남깁니다.</li></ul><h4>피신청인의 주장</h4><ul><li>검증에 유출하면 안 되는 기관 답변</li></ul>';
 const out=extract(html,'신청원인');assert.ok(out.includes('방음벽 보완'));assert.ok(out.includes('\n'));assert.ok(!out.includes('기관 답변'));
});
test('missing or truncated public source pages fail instead of generating sample complaints',()=>{
 assert.throws(()=>extract('<h4>로그인</h4>','신청원인'),/missing/);
 assert.throws(()=>extract('<h4>신청원인</h4><p>불완전한 원문</p>','신청원인'),/boundary/);
 assert.equal(text('A &amp; B &#xAC00; &#45208;'),'A & B 가 나');
});
test('source manifest distinguishes web acquisition rights without claiming broader permission',()=>{
 assert.equal(sources.cases.length,8);assert.equal(new Set(sources.cases.map(c=>c.id)).size,8);
 assert.match(sources.acquisition,/API로 받은 데이터로 표시하지 않음/);assert.match(sources.redistribution,/원문 재배포/);
});
