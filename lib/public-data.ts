import dataset from './public-complaints.json';
import {AppError} from './server';
export type PublicDataSource={recordId:string;name:string;provider:string;url:string;license:string;sourceReceivedAt:string;csvSha256:string;kind:'agency_summary'};
export function publicDataSource(recordId:string|undefined,body:string):PublicDataSource|null{
  if(!recordId)return null;
  const row=dataset.records.find(r=>r.id===recordId);
  if(!row||body!==row.complaintContent)throw new AppError('공개 자료의 원문과 출처가 일치하지 않습니다.');
  return {recordId:row.id,name:dataset.source.name,provider:dataset.source.provider,url:dataset.source.url,license:dataset.source.license,sourceReceivedAt:row.receivedAt,csvSha256:dataset.csvSha256,kind:'agency_summary'};
}
