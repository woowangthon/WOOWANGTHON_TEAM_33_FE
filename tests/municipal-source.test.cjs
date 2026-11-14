const {test}=require('node:test'),assert=require('node:assert/strict');
const {ddmSnapshot,dobongSnapshot,gijangHtml}=require('../evals/public-complaints/municipal-source.cjs');
test('municipal snapshots retain complaint text without leaking the official response',()=>{
 const snapshot='### 민원내용\n제목\n첨부파일  | \n민원\u00a0원문입니다. 단속의 이유를 설명해 주시고 직원의 응대도 확인해 주시기를 요청합니다. 처리 결과와 관련 절차도 안내해 주시기 바랍니다.\n### 답변\n공식 답변 비공개 평가 기준';
 const body=ddmSnapshot(snapshot);assert.ok(body.startsWith('민원 원문'));assert.ok(!body.includes('공식 답변'));assert.ok(!body.includes('\u00a0'));
 const other=dobongSnapshot('본문\n1.안녕하십니까\n민원 내용\n### 민원 답변 내용\n기관 답변');assert.equal(other,'1.안녕하십니까\n민원 내용');
});
test('municipal HTML extraction stops at the complaint cell and rejects unavailable pages',()=>{
 assert.equal(gijangHtml('<td style="white-space: pre-wrap; min-height:100px;"><p>피해 신고</p><p>사과 요청</p></td><td>답변</td>'),'피해 신고\n사과 요청');
 assert.throws(()=>gijangHtml('<title>오류 페이지</title>'),/missing/);assert.throws(()=>ddmSnapshot('검색 결과 없음'),/missing/);assert.throws(()=>dobongSnapshot('로그인 페이지'),/boundaries/);
});
