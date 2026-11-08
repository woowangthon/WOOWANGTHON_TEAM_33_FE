'use client';
import type { Citation, DraftReview } from '../lib/types';
import CitationText from './citation-text';

export default function DraftReviewPanel({review,draft,citations,busy,completed,onVerify}:{review:DraftReview|null|undefined;draft:string;citations:Citation[];busy:boolean;completed:boolean;onVerify:()=>void}) {
  const current=review?.validatorVersion===2&&review?.status==='checked'&&review.draft===draft.trim();
  const needsReview=current?review.sentences.filter(s=>s.status==='needs_review').length:0;
  const labels={supported:'근거 일치',needs_review:'확인 필요',not_legal:'일반 안내'};
  const renderSentence=(sentence:DraftReview['sentences'][number])=><details key={sentence.id} open={sentence.status==='needs_review'} className={'sentence-check '+sentence.status}>
    <summary><span><CitationText text={sentence.text} citations={citations}/></span><strong>{labels[sentence.status]}</strong></summary>
    <div>{sentence.status==='needs_review'?<p>{sentence.reason}</p>:null}{sentence.references.map((ref,j)=>{const source=citations.find(c=>c.id===ref.citationId);return <blockquote key={j}><strong>{source?source.title+' '+source.article:'근거 조문'}</strong><p><mark>{ref.quote}</mark></p>{source?<a href={source.sourceUrl} target="_blank" rel="noreferrer">공식 원문</a>:null}</blockquote>;})}</div>
  </details>;
  return <section className="draft-review" aria-label="답변 문장별 근거 검증">
    <div className="section-heading"><h3>법령 근거 검사{current?<span className={needsReview?'coverage-alert':'review-pass'}>{needsReview?`${needsReview}건 확인 필요`:'문제 없음'}</span>:null}</h3><button className="button outline small" disabled={busy||completed||draft.trim().length<10} onClick={onVerify}>{busy?'검사 중…':'답변 검사'}</button></div>
    {!current?<p className="muted-text">{review?.draft&&review.draft!==draft.trim()?'답변이 바뀌었습니다. 다시 검사해 주세요.':'등록하기 전에 답변 검사를 실행해 주세요.'}</p>:<>
      {review.sentences.filter(s=>s.status==='needs_review').map(renderSentence)}
      {review.sentences.some(s=>s.status!=='needs_review')?<details className="review-passed"><summary>문제없는 문장 {review.sentences.filter(s=>s.status!=='needs_review').length}개</summary>{review.sentences.filter(s=>s.status!=='needs_review').map(renderSentence)}</details>:null}
    </>}
  </section>;
}
