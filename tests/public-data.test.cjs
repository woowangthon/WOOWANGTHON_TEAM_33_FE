const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const load=require('../evals/licensed-data/evaluate.cjs').loader(),{publicDataSource}=load(path.resolve('lib/public-data.ts')),data=require('../lib/public-complaints.json');
test('public provenance is attached only to unchanged licensed source rows',()=>{
 assert.equal(data.records.length,13);assert.equal(data.source.license,'이용허락범위 제한 없음');
 for(const row of data.records){const source=publicDataSource(row.id,row.complaintContent);assert.equal(source.recordId,row.id);assert.equal(source.sourceReceivedAt,row.receivedAt);assert.equal(source.csvSha256,data.csvSha256);assert.equal(row.agencyResponse,undefined);}
 assert.equal(publicDataSource(undefined,'사용자 민원'),null);
 assert.throws(()=>publicDataSource('KOEN-001','꾸며낸 민원'),/원문과 출처/);assert.throws(()=>publicDataSource('invented','내용'),/원문과 출처/);
});
