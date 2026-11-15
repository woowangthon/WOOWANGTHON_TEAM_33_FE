'use client';
import './phone-caller.css';
import {useEffect,useRef,useState} from 'react';
import PhoneAssistance from './phone-assistance';
import PhoneHistory from './phone-history';
import {phoneHistoryScope,phoneHistorySelection} from '../lib/phone-history-scope';
import {phoneNoticeAudio} from '../lib/phone-notice';
import PhoneConversation,{type PhoneMessage} from './phone-conversation';
import './phone-chat.css';

type Segment={turnId:string;text:string;status:string;at:string;facts:{kind:string;value:string}[]};
type Call={id:string;status:'waiting'|'connecting'|'active'|'ended';source:string;callerId?:string;callerName?:string;callerCallCount?:number;startedAt:string;connectedAt?:string;shield:boolean;finalizing?:boolean;segments:Segment[];messages?:PhoneMessage[];typing?:{caller:boolean;staff:boolean};reason?:string};
type Wire={event:string;callId?:string;connectedAt?:string;message?:string;reason?:string;enabled?:boolean;payload?:string;media?:{payload:string};calls?:Call[];entry?:PhoneMessage;speaker?:'caller'|'staff';value?:boolean;kind?:string;text?:string}&Partial<Segment>;
type Session={context?:AudioContext;node?:AudioWorkletNode;source?:MediaStreamAudioSourceNode;microphone?:MediaStream;socket?:WebSocket;player?:AudioBufferSourceNode;timer?:ReturnType<typeof setTimeout>;disposed:boolean};

function releaseAudio(session:Session){
  session.microphone?.getTracks().forEach(track=>track.stop());
  session.source?.disconnect();
  session.node?.disconnect();
  void session.context?.close().catch(()=>{});
  session.microphone=undefined;session.source=undefined;session.node=undefined;session.context=undefined;
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
  const [connectedAt,setConnectedAt]=useState<number|null>(null),[elapsed,setElapsed]=useState(0),[audioPaused,setAudioPaused]=useState(false);
  const [micLevel,setMicLevel]=useState(0);
  const [micReady,setMicReady]=useState(false),[micChecking,setMicChecking]=useState(false),[micDevice,setMicDevice]=useState('');
  const [micDevices,setMicDevices]=useState<MediaDeviceInfo[]>([]),[selectedMic,setSelectedMic]=useState('');
  const micPreview=useRef<Session|null>(null);
  function stopMicPreview(){const current=micPreview.current;micPreview.current=null;if(current)release(current);setMicReady(false);setMicLevel(0);}
  async function checkMicrophone(){stopMicPreview();setMessage('');setMicChecking(true);const current:Session={disposed:false};micPreview.current=current;try{await prepareAudio(current);}catch(error){stopMicPreview();setMessage(error instanceof DOMException&&error.name==='NotAllowedError'?'마이크 사용 권한을 허용해 주세요.':'마이크를 연결하지 못했습니다. 장치 연결을 확인해 주세요.');}finally{setMicChecking(false);}}
  async function chooseMicrophone(deviceId:string){const connection=session.current?.node?session.current:micPreview.current;if(!connection?.context||!connection.node)return;setMicChecking(true);setMessage('');try{const microphone=await navigator.mediaDevices.getUserMedia({audio:{deviceId:{exact:deviceId},echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});if(connection.disposed){microphone.getTracks().forEach(track=>track.stop());return;}const source=connection.context.createMediaStreamSource(microphone);source.connect(connection.node);connection.source?.disconnect();connection.microphone?.getTracks().forEach(track=>track.stop());connection.source=source;connection.microphone=microphone;setSelectedMic(deviceId);setMicDevice(microphone.getAudioTracks()[0]?.label||'마이크');setMicLevel(0);await connection.context.resume();}catch{setMessage('선택한 마이크를 연결하지 못했습니다. 다른 장치를 선택해 주세요.');}finally{setMicChecking(false);}}
  const [pending,setPending]=useState<Record<string,string>>({});
  const textMode=useRef(false),noticePlayer=useRef<HTMLAudioElement|null>(null),noticePlaying=useRef(false),noticeSequence=useRef(0),receivingRequested=useRef(false);
  function stopNotice(){noticeSequence.current++;noticePlayer.current?.pause();noticePlayer.current=null;noticePlaying.current=false;if('speechSynthesis' in window)window.speechSynthesis.cancel();}
  function playNotice(kind:string,text:string){
    stopNotice();const sequence=noticeSequence.current,asset=phoneNoticeAudio(kind);noticePlaying.current=true;
    if(asset){const audio=new Audio(asset);noticePlayer.current=audio;const done=()=>{if(noticePlayer.current===audio){noticePlaying.current=false;noticePlayer.current=null;}};audio.onended=done;audio.onerror=done;void audio.play().catch(done);}
    else if('speechSynthesis' in window){const speech=new SpeechSynthesisUtterance(text);speech.lang='ko-KR';const done=()=>{if(noticeSequence.current===sequence)noticePlaying.current=false;};speech.onend=done;speech.onerror=done;window.speechSynthesis.speak(speech);}
    else{noticePlaying.current=false;setMessage(text);}
  }
  const session=useRef<Session|null>(null),active=useRef(''),currentCall=useRef(''),historyCall=useRef('');
  const callerHistory=phoneHistoryScope(calls,currentCall.current);
  const displayCalls=staff?callerHistory.history:calls;
  const call=displayCalls.find(c=>c.id===selected),segments=call?.segments||[];
  const waitingCall=calls.find(c=>c.status==='waiting');
  const processing=!!call?.finalizing||Object.values(pending).includes(selected);
  const connected=!['offline','ended'].includes(state);
  const duration=String(Math.floor(elapsed/60)).padStart(2,'0')+':'+String(elapsed%60).padStart(2,'0');
  function send(value:unknown){const socket=session.current?.socket;if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));}
  function disconnect(){
    send({event:'hangup',callId:currentCall.current});
    const current=session.current;session.current=null;if(current)release(current);
    active.current='';currentCall.current='';historyCall.current='';setCalls([]);setSelected('');setConnectedAt(null);setAudioPaused(false);setMicReady(false);setMicLevel(0);setState('offline');setPending({});textMode.current=false;stopNotice();
  }
  useEffect(()=>{
    let live=true;
    async function status(){try{const response=await fetch('/api/phone',{cache:'no-store',signal:AbortSignal.timeout(7000)});const data=await response.json();if(live){setOnline(response.ok&&data.online===true);setAvailable(response.ok&&data.available===true);if(staff&&receivingRequested.current&&response.ok&&data.online===true&&!session.current)void connect();}}catch{if(live){setOnline(false);setAvailable(false);}}}
    void status();const timer=setInterval(status,15000);
    return()=>{live=false;clearInterval(timer);stopNotice();const preview=micPreview.current;micPreview.current=null;if(preview)release(preview);const current=session.current;session.current=null;if(current)release(current);};
  },[]);
  useEffect(()=>{const before=(event:BeforeUnloadEvent)=>{if(currentCall.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before);},[]);
  function applyCalls(rows:Call[]){
    const visible=rows.filter(row=>row.source!=='demo');
    setCalls(visible);
    const ownedCallId=currentCall.current,previousCallId=historyCall.current;
    historyCall.current=phoneHistoryScope(visible,ownedCallId).current?.id||'';
    setSelected(previous=>staff?phoneHistorySelection(visible,ownedCallId,previous,previousCallId):visible.some(c=>c.id===previous)?previous:visible.find(c=>c.id===ownedCallId)?.id||visible[0]?.id||'');
  }
  useEffect(()=>{
    if(!staff){try{setNickname(localStorage.getItem('minwonsai-phone-nickname')||'');}catch{}}
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
    const alive=()=>(session.current===connection||micPreview.current===connection)&&!connection.disposed;
    const context=new AudioContext();connection.context=context;
    context.onstatechange=()=>{if(alive())setAudioPaused(context.state!=='running');};
    await context.resume();
    const microphone=await navigator.mediaDevices.getUserMedia({audio:{...(selectedMic?{deviceId:{exact:selectedMic}}:{}),echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
    if(!alive()){microphone.getTracks().forEach(track=>track.stop());return;}
    connection.microphone=microphone;
    setMicDevice(microphone.getAudioTracks()[0]?.label||'기본 마이크');setMicReady(true);
    setSelectedMic(microphone.getAudioTracks()[0]?.getSettings().deviceId||'');
    try{setMicDevices((await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==='audioinput'));}catch{}
    await context.audioWorklet.addModule('/phone-audio.js?v=2');if(!alive())return;
    const node=new AudioWorkletNode(context,'phone-audio',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});connection.node=node;
    node.port.postMessage({type:'capture_format',format:'pcm16-16000'});
    connection.source=context.createMediaStreamSource(microphone);connection.source.connect(node);node.connect(context.destination);
    await context.resume();if(!alive())return;
    node.port.onmessage=({data})=>{
      const socket=connection.socket;
      if(alive()&&data.type==='level')setMicLevel(noticePlaying.current?0:Math.max(0,Math.min(1,Number(data.value)||0)));
      if(alive()&&data.type==='frame'&&active.current&&socket?.readyState===WebSocket.OPEN&&socket.bufferedAmount<32000){const bytes=new Uint8Array(data.frame);if(noticePlaying.current)bytes.fill(0);socket.send(JSON.stringify({event:'media',callId:active.current,format:data.format,payload:btoa(String.fromCharCode(...bytes))}));}
    };
  }
  async function accept(){
    const call=waitingCall;
    const current=session.current;if(!current||!call||call.status!=='waiting')return;
    stopMicPreview();
    setSelected(call.id);
    setMessage('');setState('connecting');
    try{await prepareAudio(current);if(session.current===current&&!current.disposed)send({event:'accept',callId:call.id});}
    catch(error){releaseAudio(current);setState('ready');setMessage(error instanceof DOMException&&error.name==='NotAllowedError'?'전화를 받으려면 마이크 사용을 허용해 주세요.':'마이크를 연결하지 못했습니다. 다시 받아 주세요.');}
  }

  async function connect(){
    if(session.current)return;
    stopMicPreview();
    if(!staff&&!nickname.trim()){setMessage('닉네임을 입력해 주세요.');return;}
    setState('connecting');setMessage('');setElapsed(0);setConnectedAt(null);setAudioPaused(false);textMode.current=false;stopNotice();
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
          active.current='';currentCall.current='';historyCall.current='';textMode.current=false;setConnectedAt(null);setElapsed(0);setAudioPaused(false);setMicLevel(0);setPending({});connection.node?.port.postMessage({type:'clear'});setState(staff?'ready':'ended');setMessage('');
          setCalls(previous=>previous.map(c=>c.id===event.callId?{...c,status:'ended',typing:{caller:false,staff:false}}:c));if(staff)setSelected('');
          releaseAudio(connection);setMicReady(false);stopNotice();
          if(!staff){session.current=null;release(connection);}
        }
        if(event.event==='accept_error'){releaseAudio(connection);setState('ready');}
        if(event.event==='error'||event.event==='accept_error')setMessage(event.message||'연결 오류');
      };
      socket.onerror=()=>{if(alive())setMessage('통화 서버에 연결하지 못했습니다. 다시 연결해 주세요.');};
      socket.onclose=()=>{if(alive()){session.current=null;release(connection);active.current='';currentCall.current='';historyCall.current='';setCalls([]);setSelected('');setConnectedAt(null);setState('offline');setPending({});setMessage('연결이 종료되었습니다. 다시 연결해 주세요.');}};
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
    <div className="phone-mic-input">{!['active','connecting','waiting'].includes(state)&&<button type="button" onClick={()=>void checkMicrophone()} disabled={micChecking}>{micChecking?'확인 중':'마이크 확인'}</button>}<span>{!micReady?'마이크 확인 전':audioPaused?'마이크 일시 정지':noticePlaying.current?'통화 안내 중':micLevel>.002?'마이크 입력 중':'마이크 입력 대기'}</span><meter aria-label="마이크 입력 크기" min={0} max={1} value={micLevel}/>{micReady&&(micDevices.length?<select aria-label="입력 마이크 선택" value={selectedMic} onChange={event=>void chooseMicrophone(event.target.value)} disabled={micChecking}>{micDevices.map(device=><option key={device.deviceId} value={device.deviceId}>{device.label||'마이크'}</option>)}</select>:<small>{micDevice}</small>)}</div>
    {!staff&&!connected&&<div className="phone-connect-controls"><label className="phone-nickname">닉네임<input autoComplete="nickname" name="nickname" maxLength={30} value={nickname} onChange={event=>setNickname(event.target.value)} placeholder="상담에 사용할 닉네임"/></label><label className="phone-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)}/>상담 녹음·문자 기록 및 자동 분석에 동의합니다.</label><button className="primary" onClick={()=>void connect()} disabled={!online||!available||!consent||!nickname.trim()}>전화 걸기</button></div>}
    {!staff&&['waiting','connecting'].includes(state)&&<div className="phone-incoming"><span>담당자 연결 중</span><button onClick={disconnect}>취소</button></div>}
    {staff&&waitingCall&&state!=='active'&&<div className="phone-incoming" role="status"><strong>{waitingCall.callerName||'민원인'}님의 전화입니다. 받으시겠습니까?</strong><button className="primary" disabled={state==='connecting'} onClick={()=>void accept()}>받기</button></div>}
    <div className={'phone-live-columns '+(!staff?'caller-columns':'')}>
      {staff&&<PhoneHistory calls={displayCalls} selected={selected} onSelect={setSelected}/>}
      <PhoneConversation key={'conversation:'+selected} callerName={call?.callerName} messages={call?.messages||[]} staff={staff} active={call?.status==='active'} textOnly={call?.shield===true} typing={call?.typing} processing={processing}/>
      {staff&&<PhoneAssistance key={'assistance:'+selected} callId={selected} segments={segments.map(({turnId,text,facts})=>({turnId,text,facts}))}/>}
    </div>
  </section>;
}
