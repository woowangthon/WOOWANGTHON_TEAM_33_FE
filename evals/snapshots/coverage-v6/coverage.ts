import type {Complaint,CoverageReview,RequirementAudit,RequirementCheck,RequestStatus} from './types';
import {maskText} from './protection';
import {COVERAGE_VERSION} from './coverage-policy';

export const requestStatusLabels:Record<RequestStatus,string>={answered:'답변됨',refused:'처리 불가 사유 안내',clarification:'추가 확인 요청',missing:'누락·불충분'};
export function requestSources(c:Pick<Complaint,'title'|'body'|'supplements'>) {
  return [{id:'title',text:c.title},{id:'body',text:c.body},...(c.supplements||[]).filter(s=>s.role==='citizen').map(s=>({id:'supplement:'+s.id,text:s.text}))];
}
export const sourceSnapshot=(c:Pick<Complaint,'title'|'body'|'supplements'>&Partial<Pick<Complaint,'location'|'category'|'occurred_at'>>)=>JSON.stringify({sources:requestSources(c),location:c.location||'',category:c.category||'',occurredAt:c.occurred_at||''});
export const analysisSnapshot=(c:Pick<Complaint,'analysis'>)=>JSON.stringify({summary:c.analysis?.summary||'',requests:c.analysis?.requests||[]});
export function coverageIsCurrent(review:CoverageReview|null|undefined,c:Complaint,draft:string) {
  return !!review&&review.version===COVERAGE_VERSION&&review.draft===draft.trim()&&review.sourceSnapshot===sourceSnapshot(c)&&review.analysisSnapshot===analysisSnapshot(c);
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
  const raw=payload as {checks?:{id?:string;status?:string;reason?:string;sentenceIds?:string[];evidenceQuotes?:{sentenceId:string;quote:string}[];informationNeeded?:string;dependencyReason?:string;alreadyProvided?:boolean;generalAnswerPossible?:boolean}[]};
  if(!Array.isArray(raw?.checks))throw new Error('답변 누락 검사 결과를 확인하지 못했습니다.');
  const known=new Map(sentences.map(s=>[s.id,s.text]));
  const requirements=audit.requirements.map(r=>{
    const matches=raw.checks!.filter(x=>x?.id===r.id),check=matches.length===1?matches[0]:null;
    const ids=Array.isArray(check?.sentenceIds)?[...new Set(check.sentenceIds)].filter(id=>known.has(id)):[];
    let status=(['answered','refused','clarification','missing'].includes(check?.status||'')?check!.status:'missing') as RequestStatus;
    let reason=String(check?.reason||'이 요구에 대한 답변 판정이 없습니다.').slice(0,1000);
    if(status!=='missing'&&(!ids.length||ids.length!==check?.sentenceIds?.length)){status='missing';reason='답변에서 대응하는 문장을 확인하지 못했습니다.';}
    const quotes=Array.isArray(check?.evidenceQuotes)?check.evidenceQuotes:[];
    if(status!=='missing'&&(!quotes.length||quotes.some(q=>!q||!ids.includes(q.sentenceId)||typeof q.quote!=='string'||q.quote.trim().length<2||!known.get(q.sentenceId)?.includes(q.quote))||ids.some(id=>!quotes.some(q=>q?.sentenceId===id)))){
      status='missing';reason='대응 근거의 인용문이 실제 답변 문장과 일치하지 않습니다.';
    }
    if(status==='clarification'&&(check?.alreadyProvided!==false||typeof check?.informationNeeded!=='string'||check.informationNeeded.trim().length<2||typeof check?.dependencyReason!=='string'||check.dependencyReason.trim().length<5)){
      status='missing';reason='추가 질문이 이 요구에 필요한지 또는 이미 제공된 정보인지 확인하지 못했습니다.';
    }
    if(status==='clarification'&&check?.generalAnswerPossible!==false){status='missing';reason='일반적인 안내가 가능한 요구를 추가 정보 질문만으로 대신할 수 없습니다.';}
    return {...r,responseStatus:status,responseReason:maskText(reason),sentenceIds:ids};
  });
  return {version:COVERAGE_VERSION,draft:draft.trim(),sourceSnapshot:audit.sourceSnapshot,analysisSnapshot:audit.analysisSnapshot,requirements,noRequestReason:audit.noRequestReason,checkedAt:new Date().toISOString()};
}
