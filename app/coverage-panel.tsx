"use client";
import {useState} from 'react';
import {ListChecks} from 'lucide-react';
import type {Complaint,RequirementCheck} from '../lib/types';
import {coverageIsCurrent,effectiveResponse,requestStatusLabels} from '../lib/coverage';
import CitationText from './citation-text';

function Decision({item,onSave,disabled}:{item:RequirementCheck;onSave:(decision:string,reason:string)=>Promise<void>;disabled:boolean}) {
  const [decision,setDecision]=useState<string>('answered'),[reason,setReason]=useState('');
  return <details className="requirement-decision"><summary>직접 판정</summary><label>판정<select value={decision} onChange={e=>setDecision(e.target.value)} disabled={disabled}>{Object.entries(requestStatusLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}<option value="exclude">행정 요구가 아님 · 제외</option></select></label><label>수정 사유<textarea rows={2} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} placeholder="판단 근거를 작성하세요." disabled={disabled}/></label><button type="button" className="button outline small" disabled={disabled||reason.trim().length<5} onClick={()=>void onSave(decision,reason)}>판정 저장</button>{item.override?<p className="muted">이전 사유: {item.override.reason}</p>:null}</details>;
}
export default function CoveragePanel({complaint:c,draft,busy,onVerify,onChanged}:{complaint:Complaint;draft:string;busy:boolean;onVerify:()=>void;onChanged:()=>void|Promise<void>}) {
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  const review=c.coverage_review,current=coverageIsCurrent(review,c,draft),citations=c.evidence?.citations||c.analysis?.citations||[];
  const legalCurrent=c.draft_review?.draft===draft.trim();
  const rows=review?.requirements||[];
  const unresolved=rows.filter(r=>!r.override?.excluded&&(r.summaryStatus!=='preserved'||effectiveResponse(r)==='missing')).length;
  async function save(item:RequirementCheck,decision:string,reason:string){setSaving(true);setError('');try{const res=await fetch(`/api/complaints/${c.id}/coverage-decision`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:c.revision,draft,requestId:item.id,decision,reason})});const data=await res.json();if(!res.ok)throw Error(data.error||'저장하지 못했습니다.');await onChanged();}catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.');}finally{setSaving(false);}}
  return <section className="card coverage-panel compact-coverage"><details key={`${current}:${unresolved}`} open={current&&unresolved>0}><summary className="card-header"><h2><ListChecks size={18}/>요청 누락 검사</h2><span className={current&&unresolved?'coverage-alert':'count-label'}>{!current?'검사 전':unresolved?`${unresolved}건 확인 필요`:'모든 요청에 답변함'}</span></summary><div className="panel-padding">
    {!current?<div className="coverage-pending"><p>{review?'답변이 바뀌었습니다. 위의 답변 검사를 다시 실행해 주세요.':'답변 검사를 실행하면 요청마다 답변이 있는지 함께 확인합니다.'}</p></div>:null}
    {error?<p role="alert" className="form-error">{error}</p>:null}
    {current&&!rows.length?<p>처리할 요청이 없습니다.</p>:null}
    {!!rows.length?<div className={`coverage-table-scroll ${!current?'coverage-stale':''}`}><table className="coverage-table"><thead><tr><th>요청</th><th>요약 반영</th><th>답변</th></tr></thead><tbody>{[...rows].sort((a,b)=>Number(!b.override?.excluded&&(b.summaryStatus!=='preserved'||effectiveResponse(b)==='missing'))-Number(!a.override?.excluded&&(a.summaryStatus!=='preserved'||effectiveResponse(a)==='missing'))).map(r=>{
      const status=effectiveResponse(r);return <tr key={r.id} className={r.override?.excluded?'coverage-excluded':r.summaryStatus!=='preserved'||status==='missing'?'coverage-needs-review':''}><td><strong>{r.text}</strong><details className="coverage-evidence"><summary>근거 보기</summary><h4>{r.source==='title'?'접수 제목':r.source==='body'?'접수 본문':r.source.startsWith('request:')?'시민 확인 요구':'보완 답변'}</h4><q>{r.quote}</q><h4>해당 답변 문장</h4>{r.sentenceIds.map(id=>{const sentence=legalCurrent?c.draft_review?.sentences.find(s=>s.id===id):undefined;return sentence?<div className="coverage-sentence" key={id}><CitationText text={sentence.text} citations={citations}/>{sentence.status==='needs_review'?<small className="coverage-alert">근거 확인 필요</small>:null}</div>:<p key={id}>답변이 바뀌어 다시 검사해야 합니다.</p>;})}{!r.sentenceIds.length?<p>이 요청에 해당하는 문장이 없습니다.</p>:null}{r.override?<p>직접 판정 사유: {r.override.reason}</p>:null}</details></td><td><span className={`coverage-pill ${r.summaryStatus==='preserved'?'ok':'warn'}`}>{r.summaryStatus==='preserved'?'반영':r.summaryStatus==='distorted'?'의미 달라짐':'빠짐'}</span>{current&&r.summaryStatus!=='preserved'&&!r.override?.excluded?<button type="button" className="button outline small" disabled={busy||saving||c.status==='resolved'} onClick={()=>void save(r,'include','원문 요구를 확인하여 요구사항 목록에 추가합니다.')}>요청 목록에 추가</button>:null}</td><td><span className={`coverage-pill ${r.override?.excluded?'':status==='missing'?'warn':'ok'}`}>{r.override?.excluded?'제외함':requestStatusLabels[status]}</span>{current&&c.status!=='resolved'?<Decision key={review?.checkedAt+r.id} item={r} disabled={busy||saving} onSave={(decision,reason)=>save(r,decision,reason)}/>:null}</td></tr>;
    })}</tbody></table></div>:null}
  </div></details></section>;
}
