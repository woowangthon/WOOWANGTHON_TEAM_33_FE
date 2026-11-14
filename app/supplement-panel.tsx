'use client';
import { useState,type FormEvent } from 'react';
import type { Complaint } from '../lib/types';
export default function SupplementPanel({complaint:c,staff,onChanged}:{complaint:Complaint;staff:boolean;onChanged:()=>void|Promise<void>}) {
  const [text,setText]=useState(''),[photos,setPhotos]=useState<File[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const editable=!c.deleted_at&&c.status!=='resolved'&&(staff||(c.status==='waiting'&&c.supplements?.at(-1)?.role==='staff'));
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault();if(busy)return;setBusy(true);setError('');const formElement=e.currentTarget;
    try {
      if(photos.length>3||photos.some(f=>f.size>1000000))throw new Error('사진은 장당 1MB 이하, 최대 3장까지 첨부할 수 있습니다.');
      const form=new FormData();form.set('text',text);form.set('revision',String(c.revision));photos.forEach(p=>form.append('photos',p));
      const r=await fetch(`/api/complaints/${c.id}/supplements`,{method:'POST',headers:staff?{'Content-Type':'application/json'}:undefined,body:staff?JSON.stringify({text,revision:c.revision}):form});
      const result=await r.json();if(!r.ok)throw new Error(result.error||'보완 내용을 등록하지 못했습니다.');
      setText('');setPhotos([]);formElement.reset();await onChanged();
    }catch(e){setError(e instanceof Error?e.message:'등록하지 못했습니다.');}finally{setBusy(false);}
  }
  if(!staff&&!c.supplements?.length&&!editable)return null;
  return <section className="card supplement-panel panel-padding">
    <h2>{staff?'보완 요청':'보완 요청 및 추가 답변'}</h2>
    {(c.supplements||[]).map(s=><article className={'supplement-message '+s.role} key={s.id}>
      <header><strong>{s.role==='staff'?'담당자':'민원인'}</strong><time>{new Date(s.createdAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</time></header>
      {staff&&s.role!=='staff'?<details><summary>추가 답변 원문 보기</summary><p className="preserve">{s.text}</p></details>:<p className="preserve">{s.text}</p>}
      <div className="supplement-photos">{s.attachments.map(p=><a key={p.id} href={`/api/complaints/${c.id}/attachments/${p.id}`} target="_blank" rel="noreferrer"><img src={`/api/complaints/${c.id}/attachments/${p.id}`} alt={p.name} loading="lazy"/><span>{p.name}</span></a>)}</div>
    </article>)}
    {error?<p role="alert" className="warning-line">{error}</p>:null}
    {editable?<form onSubmit={submit}>
      <label htmlFor={'supplement-'+c.id}>{staff?'추가로 확인할 내용':'추가 답변'}</label>
      <textarea id={'supplement-'+c.id} required minLength={2} maxLength={4000} rows={3} value={text} onChange={e=>setText(e.target.value)} placeholder={staff?'위치, 발생 시간 등 확인할 내용을 작성하세요.':'요청받은 내용을 작성하세요.'}/>
      {!staff?<label className="photo-upload">사진 첨부 (장당 1MB 이하, 최대 3장)<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={e=>setPhotos(Array.from(e.target.files||[]))}/></label>:null}
      <button className="button primary" disabled={busy||text.trim().length<2} type="submit">{busy?'등록 중…':staff?'보완 요청 보내기':'추가 답변 제출'}</button>
    </form>:null}
  </section>;
}
