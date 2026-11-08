"use client";
import {useState} from 'react';
import {ListChecks,RefreshCw} from 'lucide-react';
import type {Complaint,RequirementCheck} from '../lib/types';
import {coverageIsCurrent,effectiveResponse,requestStatusLabels} from '../lib/coverage';
import CitationText from './citation-text';

function Decision({item,onSave,disabled}:{item:RequirementCheck;onSave:(decision:string,reason:string)=>Promise<void>;disabled:boolean}) {
  const [decision,setDecision]=useState<string>('answered'),[reason,setReason]=useState('');
  return <details className="requirement-decision"><summary>담당자 판정 수정</summary><label>판정<select value={decision} onChange={e=>setDecision(e.target.value)} disabled={disabled}>{Object.entries(requestStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}<option value="exclude">행정 요구가 아님 · 제외</option></select></label><label>수정 사유<textarea rows={2} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="판단 근거를 작성하세요." disabled={disabled}/></label><button type="button" className="button outline small" disabled={disabled||reason.trim().length<5} onClick={()=>void onSave(decision,reason)}>판정 저장</button>{item.override?<p className="muted">직전 수정 사유: {item.override.reason}</p>:null}</details>;
}
export default function CoveragePanel({complaint:c,draft,busy,onVerify,onChanged}:{complaint:Complaint;draft:string;busy:boolean;onVerify:()=>void;onChanged:()=>void|Promise<void>}) {
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const review=c.coverage_review,current=coverageIsCurrent(review,c,draft),citations=c.evidence?.citations||c.analysis?.citations||[];
  const legalCurrent=c.draft_review?.draft===draft.trim();
  const rows=review?.requirements||[];
  const unresolved=rows.filter(r=>!r.override?.excluded&&(r.summaryStatus!=='preserved'||effectiveResponse(r)==='missing')).length;
  async function save(item:RequirementCheck,decision:string,reason:string){setSaving(true);setError('');try{const res=await fetch(`/api/complaints/${c.id}/coverage-decision`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:c.revision,draft,requestId:item.id,decision,reason})});const data=await res.json();if(!res.ok)throw Error(data.error||'저장하지 못했습니다.');await onChanged();}catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.');}finally{setSaving(false);}}
  return <section className="card coverage-panel compact-coverage"><details key={`${current}:${unresolved}`} open={current&&unresolved>0}><summary className="card-header"><h2><ListChecks size={18}/>답변 누락 확인</h2><span className={current&&unresolved?'coverage-alert':'count-label'}>{!current?'검사 필요':unresolved?`${unresolved}건 확인 필요`:'누락 없음'}</span></summary><div className="panel-padding">
    {!current?<div className="coverage-pending"><p>{review?'내용이 변경되었습니다. 현재 답변으로 다시 검사해 주세요.':'원문 요구와 요약·답변을 대조해 주세요.'}</p><button type="button" className="button outline small" disabled={busy||saving||c.status==='resolved'||draft.trim().length<10} onClick={onVerify}><RefreshCw size={14}/>요구사항·근거 검사</button></div>:null}
    {error?<p role="alert" className="form-error">{error}</p>:null}
    {current&&!rows.length?<p>별도의 처리 요구가 없습니다.</p>:null}
    {!!rows.length?<div className={`coverage-table-scroll ${!current?'coverage-stale':''}`}><table className="coverage-table"><thead><tr><th>요구사항</th><th>요약</th><th>답변</th></tr></thead><tbody>{[...rows].sort((a,b)=>Number(!b.override?.excluded&&(b.summaryStatus!=='preserved'||effectiveResponse(b)==='missing'))-Number(!a.override?.excluded&&(a.summaryStatus!=='preserved'||effectiveResponse(a)==='missing'))).map(r=>{
      const status=effectiveResponse(r);return <tr key={r.id} className={r.override?.excluded?'coverage-excluded':r.summaryStatus!=='preserved'||status==='missing'?'coverage-needs-review':''}><td><strong>{r.text}</strong><details className="coverage-evidence"><summary>원문·답변 대조</summary><h4>{r.source==='title'?'접수 제목':r.source==='body'?'접수 본문':r.source.startsWith('request:')?'시민 확인 요구':'보완 답변'}</h4><q>{r.quote}</q><h4>대응하는 답변</h4>{r.sentenceIds.map(id=>{const sentence=legalCurrent?c.draft_review?.sentences.find(s=>s.id===id):undefined;return sentence?<div className="coverage-sentence" key={id}><CitationText text={sentence.text} citations={citations}/>{sentence.status==='needs_review'?<small className="coverage-alert">근거 확인 필요</small>:null}</div>:<p key={id}>답변 재검사 필요</p>;})}{!r.sentenceIds.length?<p>대응 문장 없음</p>:null}{r.override?<p>담당자 수정 사유: {r.override.reason}</p>:null}</details></td><td><span className={`coverage-pill ${r.summaryStatus==='preserved'?'ok':'warn'}`}>{r.summaryStatus==='preserved'?'반영':r.summaryStatus==='distorted'?'의미 변경':'누락'}</span>{current&&r.summaryStatus!=='preserved'&&!r.override?.excluded?<button type="button" className="button outline small" disabled={busy||saving||c.status==='resolved'} onClick={()=>void save(r,'include','원문 요구를 확인하여 요구사항 목록에 추가합니다.')}>요구 목록에 반영</button>:null}</td><td><span className={`coverage-pill ${r.override?.excluded?'':status==='missing'?'warn':'ok'}`}>{r.override?.excluded?'담당자 제외':requestStatusLabels[status]}</span>{current&&c.status!=='resolved'?<Decision key={review?.checkedAt+r.id} item={r} disabled={busy||saving} onSave={(decision,reason)=>save(r,decision,reason)}/>:null}</td></tr>;
    })}</tbody></table></div>:null}
  </div></details></section>;
}
