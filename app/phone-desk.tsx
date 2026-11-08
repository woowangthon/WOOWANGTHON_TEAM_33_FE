'use client';
import {useEffect,useRef,useState} from 'react';
import {Phone,PhoneOff,Mic,MicOff,ShieldCheck,Headphones,LoaderCircle,ChevronRight,Play,Square} from 'lucide-react';
import {categories} from '../lib/types';

type Segment={turnId:string;text:string;status:string;at:string;facts:{kind:string;value:string}[]};
type Call={id:string;status:'waiting'|'active'|'ended';source:string;startedAt:string;shield:boolean;finalizing?:boolean;segments:Segment[];reason?:string};
type Wire={event:string;callId?:string;message?:string;reason?:string;enabled?:boolean;payload?:string;media?:{payload:string};calls?:Call[]}&Partial<Segment>;
type Draft={title:string;body:string;location:string;category:string;receipt:string};
type Session={context:AudioContext;node?:AudioWorkletNode;microphone?:MediaStream;socket?:WebSocket;player?:AudioBufferSourceNode;timer?:ReturnType<typeof setTimeout>;disposed:boolean};

function release(session:Session){
  session.disposed=true;
  clearTimeout(session.timer);
  session.player?.stop();
  session.socket?.close();
  session.microphone?.getTracks().forEach(track=>track.stop());
  session.node?.disconnect();
  void session.context.close().catch(()=>{});
}

export default function PhoneDesk({staff,demo=false,onRegistered}:{staff:boolean;demo?:boolean;onRegistered?:(id:string)=>void}){
  const [online,setOnline]=useState(false),[number,setNumber]=useState<string|null>(null);
  const [state,setState]=useState('offline'),[message,setMessage]=useState('');
  const [calls,setCalls]=useState<Call[]>([]),[selected,setSelected]=useState('');
  const [muted,setMuted]=useState(false),[consent,setConsent]=useState(false),[useMic,setUseMic]=useState(!demo);
  const [level,setLevel]=useState(0),[playing,setPlaying]=useState('');
  const [pending,setPending]=useState<Record<string,string>>({});
  const [drafts,setDrafts]=useState<Record<string,Partial<Draft>>>({}),[saving,setSaving]=useState('');
  const session=useRef<Session|null>(null),active=useRef(''),savingRef=useRef(''),sampleRef=useRef(false);
  const call=calls.find(c=>c.id===selected),segments=call?.segments||[];
  const draft:Draft={title:call?.source==='demo'?'[가상 사례] 음성 상담 민원':'음성 상담 민원',body:segments.map(s=>s.text).join('\n\n'),location:segments.flatMap(s=>s.facts).find(f=>f.kind==='location')?.value||'',category:'기타',receipt:'',...drafts[selected]};
  const processing=!!call?.finalizing||Object.values(pending).includes(selected);
  const connected=!['offline','ended'].includes(state);
  function changeDraft(patch:Partial<Draft>){setDrafts(previous=>({...previous,[selected]:{...previous[selected],...patch}}));}
  function send(value:unknown){const socket=session.current?.socket;if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify(value));}
  function stopSample(){session.current?.player?.stop();if(session.current)session.current.player=undefined;sampleRef.current=false;setPlaying('');}
  function disconnect(){
    send({event:'hangup',callId:active.current});
    const current=session.current;session.current=null;if(current)release(current);
    active.current='';sampleRef.current=false;setState('offline');setLevel(0);setPlaying('');setPending({});
  }
  useEffect(()=>{
    let live=true;
    async function status(){try{const response=await fetch('/api/phone',{cache:'no-store',signal:AbortSignal.timeout(7000)});const data=await response.json();if(live){setOnline(data.online===true);setNumber(data.number);}}catch{if(live)setOnline(false);}}
    void status();const timer=setInterval(status,15000);
    return()=>{live=false;clearInterval(timer);const current=session.current;session.current=null;if(current)release(current);};
  },[]);
  useEffect(()=>{const before=(event:BeforeUnloadEvent)=>{if(active.current){event.preventDefault();event.returnValue='';}};window.addEventListener('beforeunload',before);return()=>window.removeEventListener('beforeunload',before);},[]);

  async function connect(){
    if(session.current)return;
    setState('connecting');setMessage('');setMuted(false);setLevel(0);
    let current:Session|undefined;
    try{
      current={context:new AudioContext(),disposed:false};session.current=current;
      const connection=current;
      const alive=()=>session.current===connection&&!connection.disposed;
      connection.timer=setTimeout(()=>{if(alive()){disconnect();setMessage('연결 시간이 초과되었습니다. 마이크 권한과 네트워크를 확인해 주세요.');}},30000);
      await connection.context.resume();if(!alive())return;
      if(useMic){
        const microphone=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
        if(!alive()){microphone.getTracks().forEach(track=>track.stop());return;}
        connection.microphone=microphone;
      }
      await connection.context.audioWorklet.addModule('/phone-audio.js');if(!alive())return;
      const node=new AudioWorkletNode(connection.context,'phone-audio',{numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]});connection.node=node;
      if(connection.microphone)connection.context.createMediaStreamSource(connection.microphone).connect(node);
      node.connect(connection.context.destination);
      const response=await fetch('/api/phone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({demo}),signal:AbortSignal.timeout(12000)});
      const settings=await response.json();if(!alive())return;if(!response.ok)throw new Error(settings.error||'연결을 시작하지 못했습니다.');
      if(settings.role!==(staff?'staff':'caller'))throw new Error('상담 접속 권한을 확인해 주세요.');
      const socket=new WebSocket(settings.url);connection.socket=socket;
      node.port.onmessage=({data})=>{
        if(!alive())return;
        if(data.type==='level')setLevel(data.value);
        if(data.type==='frame'&&active.current&&socket.readyState===WebSocket.OPEN&&socket.bufferedAmount<32000){const bytes=new Uint8Array(data.frame);socket.send(JSON.stringify({event:'media',callId:active.current,payload:btoa(String.fromCharCode(...bytes))}));}
      };
      socket.onopen=()=>{if(alive())socket.send(JSON.stringify({event:'auth',token:settings.token}));};
      socket.onmessage=({data})=>{
        if(!alive())return;
        let event:Wire;try{event=JSON.parse(data);}catch{return;}
        if(['ready','waiting','active','ended'].includes(event.event))clearTimeout(connection.timer);
        if(event.event==='ready')setState('ready');
        if(event.event==='calls'&&event.calls){setCalls(event.calls);setSelected(previous=>previous||event.calls?.find(item=>item.status==='waiting')?.id||'');}
        if(event.event==='waiting'){setState('waiting');setSelected(event.callId||'');}
        if(event.event==='connecting')setState('connecting');
        if(event.event==='active'){
          active.current=event.callId||'';setSelected(event.callId||'');setState('active');setMessage('');setMuted(false);node.port.postMessage({type:'muted',value:false});
        }
        if(event.event==='media'){
          const payload=event.payload||event.media?.payload;
          if(payload&&active.current){const bytes=Uint8Array.from(atob(payload),character=>character.charCodeAt(0));node.port.postMessage({type:'audio',frame:bytes.buffer},[bytes.buffer]);}
        }
        if(event.event==='clear')node.port.postMessage({type:'clear'});
        if(event.event==='protection')setMessage(event.enabled?(event.reason||'수신 음성 보호 중'):'수신 음성을 다시 연결했습니다.');
        if(event.event==='processing'&&event.turnId&&event.callId)setPending(previous=>({...previous,[event.turnId!]:event.callId!}));
        if(event.event==='neutral_text'&&event.turnId)setPending(previous=>{const next={...previous};delete next[event.turnId!];return next;});
        if(event.event==='analysis_error'){
          setPending(previous=>Object.fromEntries(Object.entries(previous).filter(([,id])=>id!==event.callId)));
          setMessage(event.message||'내용을 확인해 주세요.');
        }
        if(event.event==='ended'){
          active.current='';stopSample();node.port.postMessage({type:'clear'});setState(staff?'ready':'ended');setMessage(event.reason||'통화가 종료되었습니다.');
          if(!staff){session.current=null;release(connection);setLevel(0);}
        }
        if(event.event==='error')setMessage(event.message||'연결 오류');
      };
      socket.onerror=()=>{if(alive())setMessage('통화 서버에 연결하지 못했습니다. 다시 연결해 주세요.');};
      socket.onclose=()=>{if(alive()){session.current=null;release(connection);active.current='';sampleRef.current=false;setState('offline');setLevel(0);setPlaying('');setPending({});setMessage('연결이 종료되었습니다. 다시 연결해 주세요.');}};
    }catch(error){
      if(current&&session.current!==current)return;
      session.current=null;if(current)release(current);setState('offline');
      const denied=error instanceof DOMException&&error.name==='NotAllowedError';
      setMessage(denied?'브라우저에서 마이크 사용을 허용한 뒤 다시 연결해 주세요.':error instanceof Error?error.message:'마이크를 연결하지 못했습니다.');
    }
  }

  async function playSample(name:string){
    const current=session.current;if(!current?.node||!active.current||sampleRef.current)return;
    const callId=active.current;sampleRef.current=true;setPlaying(name);setMessage('');
    try{
      const response=await fetch('/demo-audio/'+name+'.wav');if(!response.ok)throw new Error('가상 녹음을 불러오지 못했습니다.');
      const buffer=await current.context.decodeAudioData(await response.arrayBuffer());
      if(session.current!==current||active.current!==callId||!sampleRef.current)return;
      const player=current.context.createBufferSource();player.buffer=buffer;player.connect(current.node);current.player=player;
      player.onended=()=>{player.disconnect();if(current.player===player){current.player=undefined;sampleRef.current=false;setPlaying('');}};
      player.start();
    }catch(error){if(session.current===current){sampleRef.current=false;setPlaying('');setMessage(error instanceof Error?error.message:'녹음을 전송하지 못했습니다.');}}
  }

  async function register(event:React.FormEvent){
    event.preventDefault();if(!call||call.status!=='ended'||processing||draft.receipt||savingRef.current)return;
    const callId=call.id;savingRef.current=callId;setSaving(callId);
    try{
      const response=await fetch('/api/complaints',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...draft,occurredAt:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),consent:true,channel:'phone',sample:call.source==='demo'})});
      const value=await response.json();if(!response.ok)throw new Error(value.error);
      setDrafts(previous=>({...previous,[callId]:{...draft,receipt:value.id}}));setMessage('민원을 접수했습니다.');onRegistered?.(value.id);
    }catch(error){setMessage(error instanceof Error?error.message:'접수하지 못했습니다.');}finally{savingRef.current='';setSaving('');}
  }

  return <section className="phone-desk">
    <div className="phone-heading"><div><span className="phone-eyebrow">민원 상담{demo?' · 가상 사례 시연':''}</span><h1>음성 상담</h1></div><span className={'phone-availability '+(online?'on':'')}>{online?'연결 가능':'연결 준비 중'}</span></div>
    {message&&<div className="phone-notice" role="status">{message}</div>}
    {!staff&&number&&<a className="phone-number" href={'tel:'+number}><Phone size={22}/>{number}</a>}
    {demo&&<div className="phone-demo"><strong>가상 사례 시연</strong><label><input type="checkbox" checked={useMic} disabled={connected} onChange={event=>setUseMic(event.target.checked)}/>마이크 사용</label>{!staff&&<div className="phone-actions"><button disabled={state!=='active'||!!playing||muted} onClick={()=>void playSample('normal')}><Play size={15}/>일반 민원</button><button disabled={state!=='active'||!!playing||muted} onClick={()=>void playSample('profanity')}><Play size={15}/>욕설 포함 민원</button>{playing&&<button onClick={stopSample}><Square size={15}/>전송 중지</button>}</div>}</div>}
    <div className="phone-toolbar"><div><Headphones size={24}/><strong>{state==='active'?'상담 중':state==='waiting'?'담당자 연결 대기':state==='ready'?'수신 대기 중':state==='connecting'?'연결 중':'상담 연결'}</strong>{connected&&useMic&&<span className="phone-mic-level"><Mic size={14}/><meter min={0} max={1} value={muted?0:level} aria-label="마이크 입력 음량"/></span>}</div>
      <div className="phone-actions">{!connected?<button className="primary" onClick={()=>void connect()} disabled={!online||(!staff&&!consent)}><Phone size={17}/>{staff?'수신 대기 시작':'상담 연결'}</button>:state!=='active'?<button onClick={disconnect}><PhoneOff size={17}/>{state==='connecting'?'연결 취소':staff?'수신 대기 종료':'연결 종료'}</button>:null}
        {state==='active'&&<><button onClick={()=>{const next=!muted;setMuted(next);session.current?.node?.port.postMessage({type:'muted',value:next});}}>{muted?<MicOff size={17}/>:<Mic size={17}/>} {muted?'마이크 켜기':'마이크 끄기'}</button><button className="danger" onClick={()=>send({event:'hangup',callId:active.current})}><PhoneOff size={17}/>통화 종료</button></>}
      </div>
    </div>
    {!staff&&<label className="phone-consent"><input type="checkbox" checked={consent} onChange={event=>setConsent(event.target.checked)} disabled={connected}/>상담 내용의 자동 분석 및 민원 접수 활용에 동의합니다.</label>}
    {staff&&<div className="phone-grid">
      <aside className="phone-panel phone-call-list"><h2>상담 목록 <span>{calls.length}</span></h2>{!calls.length?<p className="phone-empty">접수된 통화가 없습니다.</p>:calls.slice().reverse().map(item=><button className={selected===item.id?'selected':''} key={item.id} onClick={()=>setSelected(item.id)}><span><strong>{item.source==='demo'?'가상 사례':item.source==='phone'?'전화 수신':'인터넷 상담'}</strong><small>{new Date(item.startedAt).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'})}</small></span><b>{item.status==='waiting'?'대기':item.status==='active'?'통화 중':'종료'}</b></button>)}</aside>
      <div className="phone-panel"><div className="phone-panel-title"><h2>상담 내용</h2>{call?.status==='waiting'&&state==='ready'&&<button className="primary" onClick={()=>send({event:'accept',callId:call.id})}><Phone size={16}/>전화 받기</button>}{call?.status==='active'&&active.current===call.id&&<button onClick={()=>send({event:call.shield?'resume':'shield',callId:call.id})}><ShieldCheck size={17}/>{call.shield?'원음 듣기':'수신 음성 가리기'}</button>}</div>
        {call?.shield&&<div className="phone-shield"><ShieldCheck size={18}/>수신 음성 보호 중 · 내 목소리는 전달됩니다.</div>}
        <div className="phone-transcript" aria-live="polite">{!segments.length?<p className="phone-empty">{call?.status==='active'?'민원 내용을 듣고 있습니다.':'통화를 선택해 주세요.'}</p>:segments.map((segment,index)=><article key={segment.turnId}><time>{String(index+1).padStart(2,'0')}</time><div><p>{segment.text}</p>{segment.status==='needs_review'&&<small>내용 확인 필요</small>}</div></article>)}{processing&&<p className="phone-processing"><LoaderCircle className="spin" size={15}/>내용 정리 중</p>}</div>
        {!!segments.length&&<form className="phone-registration" onSubmit={register}><h2>민원 접수</h2><div className="phone-fields"><label>제목<input value={draft.title} onChange={event=>changeDraft({title:event.target.value})} minLength={3} maxLength={120} required disabled={!!draft.receipt}/></label><label>발생 장소<input value={draft.location} onChange={event=>changeDraft({location:event.target.value})} minLength={2} maxLength={200} required disabled={!!draft.receipt}/></label><label>민원 분야<select value={draft.category} onChange={event=>changeDraft({category:event.target.value})} disabled={!!draft.receipt}>{categories.map(category=><option key={category}>{category}</option>)}</select></label></div><label>접수 내용<textarea value={draft.body} onChange={event=>changeDraft({body:event.target.value})} minLength={10} maxLength={6000} rows={6} required disabled={!!draft.receipt}/></label><button className="primary" disabled={!!saving||!!draft.receipt||call?.status!=='ended'||processing}>{draft.receipt?'접수 완료':saving===selected?'접수 중':call?.status!=='ended'?'통화 종료 후 접수':processing?'내용 정리 중':'민원 접수 및 법령 분석'}<ChevronRight size={16}/></button>{draft.receipt&&<a className="phone-receipt" href="/">접수번호 {draft.receipt} · 접수함 열기</a>}</form>}
      </div>
    </div>}
  </section>;
}
