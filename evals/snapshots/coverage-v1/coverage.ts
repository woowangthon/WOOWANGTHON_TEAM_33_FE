import type {Complaint,CoverageReview,RequirementAudit,RequirementCheck,RequestStatus} from './types';
import {maskText} from './protection';

export const requestStatusLabels:Record<RequestStatus,string>={answered:'답변됨',refused:'처리 불가 사유 안내',clarification:'추가 확인 요청',missing:'누락·불충분'};
export function requestSources(c:Pick<Complaint,'title'|'body'|'supplements'>) {
  return [{id:'title',text:c.title},{id:'body',text:c.body},...(c.supplements||[]).filter(s=>s.role==='citizen').map(s=>({id:'supplement:'+s.id,text:s.text}))];
}
export const sourceSnapshot=(c:Pick<Complaint,'title'|'body'|'supplements'>)=>JSON.stringify(requestSources(c));
export const analysisSnapshot=(c:Pick<Complaint,'analysis'>)=>JSON.stringify({summary:c.analysis?.summary||'',requests:c.analysis?.requests||[]});
export function coverageIsCurrent(review:CoverageReview|null|undefined,c:Complaint,draft:string) {
  return !!review&&review.version===1&&review.draft===draft.trim()&&review.sourceSnapshot===sourceSnapshot(c)&&review.analysisSnapshot===analysisSnapshot(c);
}
export function effectiveResponse(r:RequirementCheck) {return r.override?.responseStatus||r.responseStatus;}
export function coverageAllowsPublication(review:CoverageReview|null|undefined,c:Complaint,draft:string) {
  return coverageIsCurrent(review,c,draft)&&!!review&&(review.requirements.length>0||review.noRequestReason.length>=5)&&review.requirements.every(r=>r.override?.excluded||(r.summaryStatus==='preserved'&&effectiveResponse(r)!=='missing'));
}
export function validateRequirementAudit(c:Complaint,payload:unknown):RequirementAudit {
  const raw=payload as {requirements?:{text?:string;source?:string;quote?:string;summaryStatus?:string;summaryReason?:string}[];noRequestReason?:string};
  if(!Array.isArray(raw?.requirements)||raw.requirements.length>30)throw new Error('요구사항 검사 결과를 확인하지 못했습니다.');
  const sources=new Map(requestSources(c).map(s=>[s.id,s.text]));
  const requirements=raw.requirements.map((r,i)=>{
    if(!r||typeof r.text!=='string'||r.text.length<2||r.text.length>600||typeof r.quote!=='string'||r.quote.length<2||r.quote.length>3000||!sources.get(r.source||'')?.includes(r.quote))throw new Error('요구사항의 원문 발췌가 실제 민원과 일치하지 않습니다.');
    if(!['preserved','missing','distorted'].includes(r.summaryStatus||''))throw new Error('요약 반영 판정을 확인하지 못했습니다.');
    return {id:'R'+(i+1),text:maskText(r.text,c.analysis?.sensitiveQuotes),source:r.source!,quote:r.quote,summaryStatus:r.summaryStatus as 'preserved'|'missing'|'distorted',summaryReason:maskText(String(r.summaryReason||'').slice(0,1000),c.analysis?.sensitiveQuotes)};
  });
  const noRequestReason=maskText(String(raw.noRequestReason||'').slice(0,1000),c.analysis?.sensitiveQuotes);
  if(!requirements.length&&noRequestReason.length<5)throw new Error('요구사항이 없다는 판단 이유가 필요합니다.');
  return {requirements,noRequestReason,sourceSnapshot:sourceSnapshot(c),analysisSnapshot:analysisSnapshot(c),checkedAt:new Date().toISOString()};
}
export function validateCoverage(audit:RequirementAudit,draft:string,sentences:{id:string;text:string}[],payload:unknown):CoverageReview {
  const raw=payload as {checks?:{id?:string;status?:string;reason?:string;sentenceIds?:string[]}[]};
  if(!Array.isArray(raw?.checks))throw new Error('답변 누락 검사 결과를 확인하지 못했습니다.');
  const known=new Map(sentences.map(s=>[s.id,s.text]));
  const requirements=audit.requirements.map(r=>{
    const matches=raw.checks!.filter(x=>x?.id===r.id),check=matches.length===1?matches[0]:null;
    const ids=Array.isArray(check?.sentenceIds)?[...new Set(check.sentenceIds)].filter(id=>known.has(id)):[];
    let status=(['answered','refused','clarification','missing'].includes(check?.status||'')?check!.status:'missing') as RequestStatus;
    let reason=String(check?.reason||'이 요구에 대한 답변 판정이 없습니다.').slice(0,1000);
    if(status!=='missing'&&(!ids.length||ids.length!==check?.sentenceIds?.length)){status='missing';reason='답변에서 대응하는 문장을 확인하지 못했습니다.';}
    return {...r,responseStatus:status,responseReason:maskText(reason),sentenceIds:ids};
  });
  return {version:1,draft:draft.trim(),sourceSnapshot:audit.sourceSnapshot,analysisSnapshot:audit.analysisSnapshot,requirements,noRequestReason:audit.noRequestReason,checkedAt:new Date().toISOString()};
}
