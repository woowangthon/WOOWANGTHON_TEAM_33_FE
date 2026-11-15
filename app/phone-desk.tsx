'use client';
import './phone-caller.css';
import {useEffect,useRef,useState} from 'react';
import PhoneAssistance from './phone-assistance';
import PhoneHistory from './phone-history';
import PhoneConversation,{type PhoneMessage} from './phone-conversation';
import './phone-chat.css';

type Segment={turnId:string;text:string;status:string;at:string;facts:{kind:string;value:string}[]};
type Call={id:string;status:'waiting'|'connecting'|'active'|'ended';source:string;callerId?:string;callerName?:string;callerCallCount?:number;startedAt:string;connectedAt?:string;shield:boolean;finalizing?:boolean;segments:Segment[];messages?:PhoneMessage[];typing?:{caller:boolean;staff:boolean};reason?:string};
type Wire={event:string;callId?:string;connectedAt?:string;message?:string;reason?:string;enabled?:boolean;payload?:string;media?:{payload:string};calls?:Call[];entry?:PhoneMessage;speaker?:'caller'|'staff';value?:boolean;kind?:string;text?:string}&Partial<Segment>;
type Session={context?:AudioContext;node?:AudioWorkletNode;microphone?:MediaStream;socket?:WebSocket;player?:AudioBufferSourceNode;timer?:ReturnType<typeof setTimeout>;disposed:boolean};

function releaseAudio(session:Session){
  session.microphone?.getTracks().forEach(track=>track.stop());
  session.node?.disconnect();
  void session.context?.close().catch(()=>{});
  session.microphone=undefined;session.node=undefined;session.context=undefined;
}
function release(session:Session){
  session.disposed=true;
  clearTimeout(session.timer);
  try{session.player?.stop();}catch{}
  session.socket?.close();
  releaseAudio(session);
}

export default function PhoneDesk({staff,demo=false,onRegistered}:{staff:boolean;demo?:boolean;onRegistered?:(id:string)=>void}){
  const [online,setOnline]=useState(false),[available,setAvailable]=useState(false);
  const [state,setState]=useState('offline'),[message,setMessage]=useState('');
  const [calls,setCalls]=useState<Call[]>([]),[selected,setSelected]=useState('');
  const [consent,setConsent]=useState(false),[nickname,setNickname]=useState('');
  const [historyLoading,setHistoryLoading]=useState(staff),[historyError,setHistoryError]=useState('');
  const [connectedAt,setConnectedAt]=useState<number|null>(null),[elapsed,setElapsed]=useState(0),[audioPaused,setAudioPaused]=useState(false);
  const [pending,setPending]=useState<Record<string,string>>({});
  const textMode=useRef(false),noticePlayer=useRef<HTMLAudioElement|null>(null),receivingRequested=useRef(false);
  function playNotice(kind:string,text:string){noticePlayer.current?.pause();const audio=new Audio('/demo-audio/'+(kind==='start'?'call-start-recording':'text-mode-caller-only')+'.wav');noticePlayer.current=audio;void audio.play().catch(()=>{});}
  const session=useRef<Session|null>(null),active=useRef(''),currentCall=useRef('');
  const call=calls.find(c=>c.id===selected),segments=call?.segments||[];
  const waitingCall=calls.find(c=>c.status==='waiting');
  const processing=!!call?.finalizing||Object.values(pending).includes(selected);
  const connected=!['offline','ended'].includes(state);
  const duration=String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(elapsed%60).padStart(2,'0');
  function send(value:unknown){const socket=session.current?.socket;if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));}
  function disconnect(){
    send({event:'hangup',callId:currentCall.current});
    const current=session.current;session.current=null;if(current)release(current);
    active.current='';currentCall.current='';setConnectedAt(null);setAudioPaused(false);setState('offline');setPending({});textMode.current=false;noticePlayer.current?.pause();
  }
  useEffect(()=>{
    let live=true;
    async function status(){try{const response=await fetch('/api/phone',{cache:'no-store',signal:AbortSignal.timeout(7000)});const data=await response.json();if(live){setOnline(response.ok&&data.online===true);setAvailable(response.ok&&data.available===true);if(staff&&receivingRequested.current&&response.ok&&data.online===true&&!session.current)void connect();}}catch{if(live){setOnline(false);setAvailable(false);}}}
    void status();const timer=setInterval(status,15000);
    return()=>{live=false;clearInterval(timer);noticePlayer.current?.pause();const current=session.current;session.current=null;if(current)release(current);};
  },[]);
  useEffect(()=>{const before=(event:BeforeUnloadEvent)=>{if(currentCall.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before);},[]);
  function applyCalls(rows:Call[]){
    const visible=rows.filter(row=>row.source!=='demo');
    setCalls(visible);setHistoryError('');setHistoryLoading(false);
    setSelected(previous=>visible.some(c=>c.id===previous)?previous:visible.find(c=>c.id===currentCall.current)?.id||visible.find(c=>c.status==='waiting')?.id||visible[0]?.id||'');
  }
  async function loadHistory(signal?:AbortSignal){
    setHistoryLoading(true);
    try{const response=await fetch('/api/phone?history=1',{cache:'no-store',signal:signal||AbortSignal.timeout(8000)});const data=await response.json();if(!response.ok||!Array.isArray(data.calls))throw Error(data.error||'상담 목록을 불러오지 못했습니다.');if(!session.current)applyCalls(data.calls);}
    catch(error){if(!signal?.aborted)setHistoryError(error instanceof Error?error.message:'상담 목록을 불러오지 못했습니다.');}
    finally{if(!signal?.aborted)setHistoryLoading(false);}
  }
  useEffect(()=>{
    if(!staff){try{setNickname(localStorage.getItem('minwonsai-phone-nickname')||'');}catch{}return;}
    const controller=new AbortController();void loadHistory(controller.signal);return()=>controller.abort();
  },[staff]);
  useEffect(()=>{
    if(connectedAt===null)return;
    const tick=()=>setElapsed(Math.max(0,Math.floor((Date.now()-connectedAt)/1000)));
    tick();const timer=setInterval(tick,1000);return()=>clearInterval(timer);
  },[connectedAt]);
  useEffect(()=>{
    if(state!=='active'||!('wakeLock' in navigator))return;
    let live=true,lock:WakeLockSentinel|undefined;
    const keepAwake=async()=>{if(document.visibilityState!=='visible'||lock&&!lock.released)return;try{const next=await navigator.wakeLock.request('screen');if(!live)await next.release();else lock=next;}catch{}};
    void keepAwake();document.addEventListener('visibilitychange',keepAwake);
    return()=>{live=false;document.removeEventListener('visibilitychange',keepAwake);void lock?.release().catch(()=>{});};
  },[state]);

  async function prepareAudio(connection:Session){
    if(connection.node){await connection.context?.resume();return;}
    const alive=()=>session.current===connection&&!connection.disposed;
    const context=new AudioContext();connection.context=context;
    context.onstatechange=()=>{if(alive())setAudioPaused(context.state!=='running');};
    await context.resume();
    const microphone=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    if(!alive()){microphone.getTracks().forEach(track=>track.stop());return;}
    connection.microphone=microphone;
    await context.audioWorklet.addModule('/phone-audio.js?v=2');if(!alive())return;
    const node=new AudioWorkletNode(context,'phone-audio',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});connection.node=node;
    node.port.postMessage({type:'capture_format',format:'pcm16-16000'});
    context.createMediaStreamSource(microphone).connect(node);node.connect(context.destination);
    node.port.onmessage=({data})=>{
      const socket=connection.socket;
      if(alive()&&data.type==='frame'&&active.current&&socket?.readyState===WebSocket.OPEN&&socket.bufferedAmount<32000){const bytes=new Uint8Array(data.frame);socket.send(JSON.stringify({event:'media',callId:active.current,format:data.format,payload:btoa(String.fromCharCode(...bytes))}));}
    };
  }
  async function accept(){
    const call=waitingCall;
    const current=session.current;if(!current||!call||call.status!=='waiting')return;
    setSelected(call.id);
    setMessage('');setState('connecting');
    try{await prepareAudio(current);if(session.current===current&&!current.disposed)send({event:'accept',callId:call.id});}
    catch(error){releaseAudio(current);setState('ready');setMessage(error instanceof DOMException&&error.name==='NotAllowedError'?'전화를 받으려면 마이크 사용을 허용해 주세요.':'마이크를 연결하지 못했습니다. 다시 받아 주세요.');}
  }

  async function connect(){
    if(session.current)return;
    if(!staff&&!nickname.trim()){setMessage('닉네임을 입력해 주세요.');return;}
    setState('connecting');setMessage('');setElapsed(0);setConnectedAt(null);setAudioPaused(false);
    let current:Session|undefined;
    try{
      current={disposed:false};session.current=current;
      const connection=current;
      const alive=()=>session.current===connection&&!connection.disposed;
      connection.timer=setTimeout(()=>{if(alive()){disconnect();setMessage('연결 시간이 초과되었습니다. 마이크 권한과 네트워크를 확인해 주세요.');}},30000);
      if(!staff){await prepareAudio(connection);try{localStorage.setItem('minwonsai-phone-nickname',nickname.trim());}catch{}}if(!alive())return;
      const response=await fetch('/api/phone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({demo:false,nickname:staff?undefined:nickname.trim()}),signal:AbortSignal.timeout(12000)});
      const settings=await response.json();if(!alive())return;if(!response.ok)throw new Error(settings.error||'연결을 시작하지 못했습니다.');
      if(settings.role!==(staff?'staff':'caller'))throw new Error('상담 접속 권한을 확인해 주세요.');
      const socket=new WebSocket(settings.url);connection.socket=socket;
      socket.onopen=()=>{if(alive())socket.send(JSON.stringify({event:'auth',token:settings.token}));};
      socket.onmessage=({data})=>{
        if(!alive())return;
        let event:Wire;try{event=JSON.parse(data);}catch{return;}
        if(['ready','waiting','active','ended'].includes(event.event))clearTimeout(connection.timer);
        if(event.event==='ready')setState('ready');
        if(event.event==='calls'&&event.calls)applyCalls(event.calls);
        if(event.event==='waiting'){currentCall.current=event.callId||'';setState('waiting');setSelected(event.callId||'');}
        if(event.event==='connecting'){currentCall.current=event.callId||'';setSelected(event.callId||'');setState('connecting');}
        if(event.event==='active'){
          active.current=event.callId||'';currentCall.current=active.current;setConnectedAt(Date.parse(event.connectedAt||'')||Date.now());setSelected(event.callId||'');setState('active');setMessage('');textMode.current=false;connection.node?.port.postMessage({type:'muted',value:false});
        }
        if(event.event==='media'){
          const payload=event.payload||event.media?.payload;
          if(payload&&active.current&&(!staff||!textMode.current)){const bytes=Uint8Array.from(atob(payload),character=>character.charCodeAt(0));connection.node?.port.postMessage({type:'audio',frame:bytes.buffer},[bytes.buffer]);}
        }
        if(event.event==='clear')connection.node?.port.postMessage({type:'clear'});
        if(event.event==='protection'){
          textMode.current=event.enabled===true;if(staff)connection.node?.port.postMessage({type:'clear'});
          setCalls(previous=>previous.map(c=>c.id===event.callId?{...c,shield:event.enabled===true}:c));
        }
        if(event.event==='announcement'&&event.text)playNotice(event.kind||'start',event.text);
        if(event.event==='conversation'&&event.entry)setCalls(previous=>previous.map(c=>c.id===event.callId?{...c,messages:[...(c.messages||[]).filter(m=>m.id!==event.entry!.id),event.entry!].sort((a,b)=>a.at.localeCompare(b.at))}:c));
        if(event.event==='typing'&&event.speaker)setCalls(previous=>previous.map(c=>c.id===event.callId?{...c,typing:{caller:false,staff:false,...c.typing,[event.speaker!]:event.value===true}}:c));
        if(event.event==='finalized'&&!staff){session.current=null;release(connection);}

        if(event.event==='processing'&&event.turnId&&event.callId)setPending(previous=>({...previous,[event.turnId!]:event.callId!}));
        if(['neutral_text','processing_done'].includes(event.event)&&event.turnId)setPending(previous=>{const next={...previous};delete next[event.turnId!];return next;});
        if(event.event==='analysis_error'){
          setPending(previous=>Object.fromEntries(Object.entries(previous).filter(([,id])=>id!==event.callId)));
          setMessage(event.message||'내용을 확인해 주세요.');
        }
        if(event.event==='ended'){
          active.current='';currentCall.current='';setConnectedAt(null);connection.node?.port.postMessage({type:'clear'});setState(staff?'ready':'ended');setMessage('');
          releaseAudio(connection);noticePlayer.current?.pause();
        }
        if(event.event==='accept_error'){releaseAudio(connection);setState('ready');}
        if(event.event==='error'||event.event==='accept_error')setMessage(event.message||'연결 오류');
      };
      socket.onerror=()=>{if(alive())setMessage('통화 서버에 연결하지 못했습니다. 다시 연결해 주세요.');};
      socket.onclose=()=>{if(alive()){session.current=null;release(connection);active.current='';currentCall.current='';setConnectedAt(null);setState('offline');setPending({});setMessage('연결이 종료되었습니다. 다시 연결해 주세요.');}};
    }catch(error){
      if(current&&session.current!==current)return;
      session.current=null;if(current)release(current);setState('offline');
      const denied=error instanceof DOMException&&error.name==='NotAllowedError';
      setMessage(denied?'브라우저에서 마이크 사용을 허용한 뒤 다시 연결해 주세요.':error instanceof Error?error.message:'마이크를 연결하지 못했습니다.');
    }
  }

  async function resumeAudio(){try{await session.current?.context?.resume();}catch{setMessage('오디오를 켜지 못했습니다. 통화를 다시 연결해 주세요.');}}

  return <section className={'phone-desk phone-live '+(staff?'phone-staff':'phone-caller')}>
    <div className="phone-heading"><h1>{staff?'전화 상담':'민원 상담'}</h1><div className="phone-actions">
      {state==='active'?<><button className="phone-call-status" disabled>통화 중</button><span className="phone-duration-small">{duration}</span>{selected!==active.current&&<button onClick={()=>setSelected(active.current)}>현재 통화</button>}<button className="danger" onClick={()=>send({event:'hangup',callId:active.current})}>종료</button></>:staff&&<button className="primary" disabled={!online||connected} onClick={()=>{receivingRequested.current=true;void connect();}}>{state==='connecting'?'수신 준비 중':connected?'수신 대기 중':'수신 시작'}</button>}
    </div></div>
    {message&&<div className="phone-notice" role="alert">{message}</div>}
    {state==='active'&&audioPaused&&<button onClick={()=>void resumeAudio()}>오디오 켜기</button>}
    {!staff&&!connected&&<div className="phone-connect-controls"><label className="phone-nickname">닉네임<input autoComplete="nickname" name="nickname" maxLength={30} value={nickname} onChange={event=>setNickname(event.target.value)} placeholder="상담에 사용할 닉네임"/></label><label className="phone-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/>상담 녹음·문자 기록 및 자동 분석에 동의합니다.</label><button className="primary" onClick={()=>void connect()} disabled={!online||!available||!consent||!nickname.trim()}>전화 걸기</button></div>}
    {!staff&&['waiting','connecting'].includes(state)&&<div className="phone-incoming"><span>담당자 연결 중</span><button onClick={disconnect}>취소</button></div>}
    {staff&&waitingCall&&state!=='active'&&<div className="phone-incoming" role="status"><strong>{waitingCall.callerName||'민원인'}님의 전화입니다. 받으시겠습니까?</strong><button className="primary" disabled={state==='connecting'} onClick={()=>void accept()}>받기</button></div>}
    <div className={'phone-live-columns '+(!staff?'caller-columns':'')}>
      {staff&&<PhoneHistory calls={calls} selected={selected} onSelect={setSelected} loading={historyLoading} error={historyError} onRetry={()=>void loadHistory()}/>}
      <PhoneConversation key={'conversation:'+selected} callerName={call?.callerName} messages={call?.messages||[]} staff={staff} active={call?.status==='active'} textOnly={call?.shield===true} typing={call?.typing} processing={processing}/>
      {staff&&<PhoneAssistance key={'assistance:'+selected} callId={selected} segments={segments.map(({turnId,text,facts})=>({turnId,text,facts}))}/>}
    </div>
  </section>;
}
