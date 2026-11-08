'use client';
import {useState} from 'react';
import type {Complaint,TrackedRequest,RequestProgress} from '../lib/types';
import {seedTracking,trackingCounts,progressLabels} from '../lib/request-tracking';
import {maskText} from '../lib/protection';

type Editable={id?:string;text:string;withdrawn:boolean;key:string};
function ProgressForm({item,staff,save,busy,revision}:{item:TrackedRequest;staff:boolean;save:(v:Record<string,unknown>,revision?:number)=>Promise<void>;busy:boolean;revision:number}) {
  const [choice,setChoice]=useState<RequestProgress|null>(null),[note,setNote]=useState(''),[editRevision,setEditRevision]=useState<number|null>(null);
  const state=choice||item.state;
  if(!staff&&item.state!=='waiting')return null;
  return <form className="request-progress-form" onSubmit={e=>{e.preventDefault();void save(staff?{action:'progress',id:item.id,state,note}:{action:'reply',id:item.id,text:note},editRevision??revision).then(()=>{setNote('');setChoice(null);setEditRevision(null);}).catch(()=>{});}}>
    {staff?<label>처리 상태<select aria-label="처리 상태" value={state} onChange={e=>{setChoice(e.target.value as RequestProgress);setEditRevision(old=>old??revision);}}>{Object.entries(progressLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>:null}
    <label>{staff?(state==='completed'?'실제 처리 결과':state==='waiting'?'시민에게 확인할 내용':'처리 내용·사유'):'추가 정보 답변'}<textarea value={note} onChange={e=>{setNote(e.target.value);setEditRevision(old=>old??revision);}} minLength={staff?5:2} maxLength={2000} required rows={2} placeholder={staff?'시민에게도 표시됩니다.':'요청받은 정보를 입력해 주세요.'}/></label>
    <button type="submit" className="button outline small" disabled={busy||note.trim().length<(staff?5:2)}>{staff?'처리 상태 저장':'추가 정보 보내기'}</button>
  </form>;
}
export default function RequestTrackingPanel({complaint:c,staff,onChanged}:{complaint:Complaint;staff:boolean;onChanged:()=>void|Promise<void>}) {
  const tracking=seedTracking(c),counts=trackingCounts(tracking);
  const [editing,setEditing]=useState(false),[rows,setRows]=useState<Editable[]>([]),[editRevision,setEditRevision]=useState(c.revision),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const show=(text:string)=>staff?maskText(text,c.analysis?.sensitiveQuotes):text;
  async function save(value:Record<string,unknown>,revision=c.revision){
    setBusy(true);setError('');setNotice('');
    try{const r=await fetch(`/api/complaints/${c.id}/requirements`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...value,revision})});const data=await r.json();if(!r.ok)throw new Error(data.error||'저장하지 못했습니다.');setEditing(false);await onChanged();setNotice('저장했습니다.');}
    catch(e){setError(e instanceof Error?e.message:'저장하지 못했습니다.');throw e;}finally{setBusy(false);}
  }
  function edit(){setRows(tracking.items.map(r=>({id:r.id,text:r.text,withdrawn:r.withdrawn,key:r.id})));setEditRevision(c.revision);setEditing(true);setError('');setNotice('');}
  return <section className="request-tracking card">
    <div className="request-tracking-heading"><div><h2>{staff?'요청 사항':'요구사항 확인 및 처리 현황'}</h2><p>{[`${counts.active}건`,counts.pending?`진행 중 ${counts.pending}`:'',counts.completed?`처리 완료 ${counts.completed}`:'',counts.unavailable?`처리 불가 ${counts.unavailable}`:''].filter(Boolean).join(' · ')}</p></div>
      <span className={'request-confirmation'+(tracking.confirmedAt?' confirmed':'')}>{(staff?'민원인 ':'')+(tracking.confirmedAt?'확인 완료':'확인 전')}</span>
    </div>
    {!staff&&!editing?<div className="request-citizen-actions"><button type="button" className="button outline small" disabled={busy} onClick={edit}>{tracking.confirmedAt?'요구사항 수정':'요구사항 확인·수정'}</button></div>:null}
    {editing?<form className="request-editor" onSubmit={e=>{e.preventDefault();void save({action:'confirm',items:rows.map(({key:_key,...r})=>r)},editRevision).catch(()=>{});}}>
      {rows.map((r,i)=><div className={'request-edit-row'+(r.withdrawn?' withdrawn':'')} key={r.key}><label>요구사항 {i+1}<textarea required minLength={2} maxLength={600} rows={2} value={r.text} onChange={e=>setRows(old=>old.map(x=>x.key===r.key?{...x,text:e.target.value}:x))}/></label><label className="request-withdraw"><input type="checkbox" checked={r.withdrawn} onChange={e=>setRows(old=>old.map(x=>x.key===r.key?{...x,withdrawn:e.target.checked}:x))}/>이 요청 철회</label>{!r.id?<button type="button" className="button quiet small" onClick={()=>setRows(old=>old.filter(x=>x.key!==r.key))}>추가 취소</button>:null}</div>)}
      <div className="request-form-actions"><button type="button" className="button outline small" disabled={rows.length>=30||busy} onClick={()=>setRows(old=>[...old,{key:crypto.randomUUID(),text:'',withdrawn:false}])}>요구사항 추가</button><button type="submit" className="button primary small" disabled={busy||!rows.length}>확인하고 저장</button><button type="button" className="button quiet small" disabled={busy} onClick={()=>setEditing(false)}>취소</button></div>
      {editRevision!==c.revision?<p role="status">민원 내용이 갱신되었습니다. 수정 내용을 보관한 뒤 취소하고 목록을 다시 열어 주세요.</p>:null}
    </form>:<div className="request-list">{tracking.items.length?tracking.items.map((item,i)=><article key={item.id} className={'request-item'+(item.withdrawn?' withdrawn':'')}>
      <div className="request-item-heading"><h3>{i+1}. {show(item.text)}</h3><span className={'request-state state-'+item.state}>{item.withdrawn?'요청 철회':progressLabels[item.state]}</span></div>
      {item.note?<p className="request-note">{show(item.note)}</p>:null}
      {!item.withdrawn?(staff?<details className="request-change"><summary>상태 변경</summary><ProgressForm key={item.id} item={item} staff save={save} busy={busy} revision={c.revision}/></details>:<ProgressForm key={item.id} item={item} staff={false} save={save} busy={busy} revision={c.revision}/>):null}
      {item.history.length?<details className="request-history"><summary>변경 이력 ({item.history.length})</summary>{[...item.history].reverse().map((h,j)=><div key={h.at+':'+j}><small>{h.actor==='citizen'?'민원인':'담당자'} · {new Date(h.at).toLocaleString('ko-KR')} · {h.withdrawn?'요청 철회':progressLabels[h.state]}</small><p>{show(h.text)}</p><p>{show(h.note)}</p></div>)}</details>:null}
    </article>):<p className="request-empty">{staff?'분석이 끝나면 요청 사항이 여기에 정리됩니다.':'정리된 요구사항이 아직 없습니다. 요구사항을 직접 추가할 수 있습니다.'}</p>}</div>}
    {error?<p className="request-error" role="alert">{error}</p>:null}{notice?<p role="status" className="request-notice">{notice}</p>:null}
  </section>;
}
