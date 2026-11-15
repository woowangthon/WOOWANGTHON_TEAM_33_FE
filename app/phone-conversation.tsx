'use client';
import {useEffect,useRef,useState} from 'react';

export type PhoneMessage={id:string;speaker:'caller'|'staff';text:string;at:string;redacted?:boolean};
export default function PhoneConversation({messages,callerName='민원인',staff,active,textOnly,typing,processing}:{messages:PhoneMessage[];callerName?:string;staff:boolean;active:boolean;textOnly:boolean;typing?:{caller:boolean;staff:boolean};processing:boolean}){
  const container=useRef<HTMLDivElement>(null),follow=useRef(true);
  const [unread,setUnread]=useState(false);
  const latest=messages.at(-1)?.id+'|'+messages.at(-1)?.text;
  useEffect(()=>{if(follow.current){container.current?.scrollTo({top:container.current.scrollHeight});setUnread(false);}else setUnread(true);},[latest,typing?.caller,typing?.staff,processing]);
  const role=staff?'staff':'caller';
  return <section className="phone-chat-panel" aria-label="실시간 대화">
    <header className="phone-chat-heading"><h2>실시간 대화</h2><span className={textOnly?'text-mode':'voice-mode'}>{textOnly?(staff?'텍스트 모드 · 민원인 음성 차단':'텍스트 모드 · 담당자 음성 수신'):active?'음성 상담 중':'상담 기록'}</span></header>
    <div className="phone-chat-log" ref={container} role="log" aria-live="polite" aria-relevant="additions text" onScroll={()=>{const el=container.current;if(el)follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<60;}}>
      {!messages.length&&<p className="phone-chat-empty">{active?'말씀하시면 대화가 여기에 표시됩니다.':'전화가 연결되면 대화가 시작됩니다.'}</p>}
      {messages.map(message=><article className={'phone-bubble-row '+(message.speaker===role?'mine':'theirs')} key={message.id}>
        <div className="phone-bubble-meta"><strong>{message.speaker==='staff'?'담당자':callerName}{message.speaker===role?' · 나':''}</strong><time dateTime={message.at}>{new Date(message.at).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'})}</time></div>
        <p className={'phone-bubble '+(message.redacted?'redacted':'')}>{message.text}</p>
      </article>)}
      {(typing?.caller||typing?.staff||processing)&&<p className="phone-chat-listening" role="status">{typing?.caller?'민원인이 말하고 있습니다…':typing?.staff?'담당자가 말하고 있습니다…':'말씀하신 내용을 확인하고 있습니다…'}</p>}
    </div>
    {unread&&<button className="phone-new-message" onClick={()=>{follow.current=true;container.current?.scrollTo({top:container.current.scrollHeight});setUnread(false);}}>새 대화 보기 ↓</button>}
  </section>;
}
