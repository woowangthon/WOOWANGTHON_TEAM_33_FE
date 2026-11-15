'use client';
import {useEffect,useRef,useState} from 'react';
import type {Assistance,AssistanceInput} from '../lib/phone-assistance';
import {mergeAssistance} from '../lib/phone-assistance-result';
export default function PhoneAssistance({callId,segments,archived=false,context}:{callId:string;segments:AssistanceInput['segments'];archived?:boolean;context?:Pick<AssistanceInput,'conversation'|'priorCalls'>}){
 const [result,setResult]=useState<Assistance|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[retry,setRetry]=useState(0);
 const snapshot=JSON.stringify({segments,...context}),desired=useRef(snapshot),running=useRef(false),last=useRef(''),mounted=useRef(true),controller=useRef<AbortController|null>(null),version=useRef(0);
 const retryTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),retryAttempts=useRef(0);
 const shown=useRef<Assistance|null>(null);
 function retryAutomatically(){if(!mounted.current)return;clearTimeout(retryTimer.current);const delay=Math.min(15000,2000*2**Math.min(retryAttempts.current++,3));retryTimer.current=setTimeout(()=>{if(mounted.current)setRetry(n=>n+1);},delay);}
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(retryTimer.current);controller.current?.abort();};},[]);
 useEffect(()=>{
  if(desired.current!==snapshot){clearTimeout(retryTimer.current);retryAttempts.current=0;}
  desired.current=snapshot;
  if(!segments.length||!callId)return;
  // Complete in-flight work; coalesce speech into the next request instead of starving updates.
  const timer=setTimeout(async()=>{
   if(running.current)return;
   running.current=true;setBusy(true);setError('');
   try{
    do{
     const input=desired.current,revision=String(++version.current);controller.current=new AbortController();
     const response=await fetch('/api/phone/assistance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({callId,revision,...JSON.parse(input)}),signal:AbortSignal.any([controller.current.signal,AbortSignal.timeout(45000)])});
     const data=await response.json();if(!response.ok)throw Error(data.error||'지원 내용을 확인하지 못했습니다.');
     if(!mounted.current)return;
     if(data.callId!==callId||data.revision!==revision)throw Error('다른 통화의 응답은 표시하지 않았습니다.');
     const merged=mergeAssistance(last.current===input?shown.current:null,data);last.current=input;shown.current=merged;setResult(merged);
     if(merged.pendingRequestIds?.length){setError('남은 답변을 준비하고 있습니다.');retryAutomatically();break;}
     retryAttempts.current=0;clearTimeout(retryTimer.current);
    }while(mounted.current&&desired.current!==last.current);
   }catch{if(mounted.current){setError('답변을 준비하고 있습니다.');retryAutomatically();}}
   finally{running.current=false;if(mounted.current)setBusy(false);}
  },450);
  return()=>clearTimeout(timer);
 // Serialized input avoids refetching for microphone levels and call timers.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[callId,snapshot,retry]);
 return <aside className="phone-assistance" aria-labelledby="phone-assistance-title">
  <header className="phone-assistance-heading"><h2 id="phone-assistance-title">{archived?'상담 내용 검토':'실시간 상담 지원'}</h2></header>
  <p className="phone-assistance-status" role="status">{error|| (busy?(result?'새 대화를 반영하고 있습니다. 아래는 이전 발화 기준입니다.':'대화에 맞는 근거와 답변을 확인하고 있습니다.'):result?'최근 대화 반영 · '+new Date(result.generatedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'Asia/Seoul'}):'상담 내용에 맞춰 자동으로 표시됩니다.')}</p>
  <div className="phone-assistance-body" aria-busy={busy}>
   <section className="phone-assistance-block"><h3>관련 법령</h3>
    {result?.citations.length?result.citations.map(c=><article className="phone-law-card" key={c.id}><a href={c.sourceUrl} target="_blank" rel="noopener noreferrer">{c.title} {c.article}</a><p>{[...(result.relatedSources||[]),...result.items.flatMap(i=>i.references)].find(r=>r.citationId===c.id)?.quote}</p><small>시행 {c.effectiveDate} · 개별 사안 적용 확인 필요</small></article>):<p className="phone-support-empty">{result?'직접 뒷받침하는 공식 근거가 아직 확인되지 않았습니다.':'관련 조문이 확인되면 여기에 표시됩니다.'}</p>}
   </section>
   <section className="phone-assistance-block"><h3>답변 초안</h3>
    {result?.items.length?result.items.map(item=><article key={item.requestId}><p className="phone-assistance-reply">{item.reply}</p>{item.checks.length>0&&<div className="phone-assistance-checks"><ul>{item.checks.map((check,i)=><li key={i}>{check}</li>)}</ul></div>}</article>):<p className="phone-support-empty">민원인의 요청이 확인되면 답변 초안이 표시됩니다.</p>}
   </section>
  </div>
 </aside>;
}
