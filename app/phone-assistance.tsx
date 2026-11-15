'use client';
import {useEffect,useRef,useState} from 'react';
import {LoaderCircle,RefreshCw,BookOpen} from 'lucide-react';
import type {Assistance,AssistanceInput} from '../lib/phone-assistance';

export default function PhoneAssistance({callId,segments}:{callId:string;segments:AssistanceInput['segments']}){
 const [result,setResult]=useState<Assistance|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const serial=useRef(0),cache=useRef<{snapshot:string;result:Assistance}|null>(null);
 const snapshot=JSON.stringify(segments);
 useEffect(()=>{
  const version=++serial.current,controller=new AbortController();
  if(!segments.length){setResult(null);setBusy(false);setError('');return;}
  if(cache.current?.snapshot===snapshot&&!retry){setResult(cache.current.result);setBusy(false);setError('');return;}
  setBusy(true);setError('');
  const timer=setTimeout(async()=>{
   try{
    const revision=String(version),response=await fetch('/api/phone/assistance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callId,revision,segments:JSON.parse(snapshot)}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(25000)])});
    const data=await response.json();if(!response.ok)throw Error(data.error||'답변을 불러오지 못했습니다.');
    if(version!==serial.current||controller.signal.aborted||data.callId!==callId||data.revision!==revision)return;
    cache.current={snapshot,result:data};setResult(data);
   }catch(e){if(version===serial.current&&!controller.signal.aborted)setError(e instanceof Error&&e.name!=='TimeoutError'?e.message:'답변 생성이 지연되었습니다. 다시 시도해 주세요.');}
   finally{if(version===serial.current&&!controller.signal.aborted)setBusy(false);}
  },450);
  return()=>{clearTimeout(timer);controller.abort();};
 // The serialized payload is the dependency; unrelated call-list updates must not restart inference.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[callId,snapshot,retry]);
 return <section className="phone-assistance" aria-labelledby="phone-assistance-title">
  <div className="phone-assistance-heading"><div><h2 id="phone-assistance-title">통화 중 답변 도움</h2><p>담당자가 확인하고 안내할 초안입니다.</p></div>{segments.length>0&&<button onClick={()=>setRetry(n=>n+1)} disabled={busy} aria-label="답변 초안 다시 생성"><RefreshCw size={15}/>다시 생성</button>}</div>
  <div className="phone-assistance-status" role="status">{busy?<><LoaderCircle size={15} className="spin"/>{result?'새 발화를 반영하고 있습니다. 아래 내용은 이전 발화 기준입니다.':'요청별 답변과 확인할 사항을 정리하고 있습니다.'}</>:error?<span>{error}{result&&cache.current?.snapshot!==snapshot?' 아래 내용은 이전 발화 기준입니다.':''}</span>:result?<span>최근 확정 발화 반영 · {new Date(result.generatedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</span>:<span>처리 요청이 확인되면 답변 초안이 자동으로 표시됩니다.</span>}</div>
  {result&&<div aria-busy={busy}>
   {result.items.map(item=><article className="phone-assistance-item" key={item.requestId}><h3>{item.request}</h3><p className="phone-assistance-reply">{item.reply}</p>
    {item.checks.length>0&&<div className="phone-assistance-checks"><strong>추가 확인</strong><ul>{item.checks.map((check,i)=><li key={i}>{check}</li>)}</ul></div>}
    {item.references.length>0&&<details><summary><BookOpen size={14}/>관련 근거 {item.references.length}개</summary>{item.references.map((ref,i)=>{const c=result.citations.find(c=>c.id===ref.citationId);return c?<div className="phone-assistance-source" key={i}><a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">{c.title} {c.article}</a><p>{ref.quote}</p><small>시행일 {c.effectiveDate} · 개별 사안 적용 확인 필요</small></div>:null;})}</details>}
   </article>)}
   {result.warnings.length>0&&<p className="phone-assistance-warning">{result.warnings.join(' ')}</p>}
  </div>}
 </section>;
}
