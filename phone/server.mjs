import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {verifyTicket} from './token.mjs';
import {FilterRelay} from './filter-relay.mjs';
import {CallAnalysis} from './analysis.mjs';
import {GeminiCallAnalysis} from './gemini-analysis.mjs';
import {pcm16ToMuLaw} from './audio.mjs';
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
const send=(socket,event)=>{
  if(socket?.readyState===Ws.OPEN&&socket.bufferedAmount<128000)socket.send(JSON.stringify(event));
};

export function createPhoneServer({secret,key,geminiKey,analysisProvider='gemini',textProvider='gemini',origins=[],model='gpt-6-luna',geminiModel='gemini-3.5-flash-lite',transcriptionModel='gemini-3.5-transcribe-live',safetyIntervalMs=400,playbackDelayMs=2500,analysisFactory,maxCallSeconds=600,waitSeconds=60,heartbeatMs=15000,maxDailySeconds=1800}){
  if(!['openai','gemini'].includes(analysisProvider))throw Error('Invalid_phone_analysis_provider');
  if(!['openai','gemini'].includes(textProvider))throw Error('Invalid_phone_text_provider');
  if(!secret||(!analysisFactory&&(analysisProvider==='gemini'?(!geminiKey||(textProvider==='openai'&&!key)):!key)))throw new Error('Phone_server_configuration_missing');
  if(!Number.isFinite(playbackDelayMs)||playbackDelayMs<0||playbackDelayMs>10000)throw Error('Invalid_audio_delay');
  analysisFactory??=options=>analysisProvider==='gemini'?new GeminiCallAnalysis({...options,geminiKey,textProvider,model:textProvider==='openai'?model:geminiModel,transcriptionModel,safetyIntervalMs}):new CallAnalysis(options);
  if(!Number.isFinite(maxCallSeconds)||maxCallSeconds<=0||maxCallSeconds>600||!Number.isFinite(maxDailySeconds)||maxDailySeconds<=0||maxDailySeconds>1800)throw new Error('Invalid_call_limit');
  const agents=new Set(),calls=new Map(),usedTickets=new Map();let dailyDate='',dailySeconds=0;
  const active=()=>[...calls.values()].filter(c=>!c.ended);
  const snapshot=c=>({id:c.id,status:c.ended?'ended':c.ready?'active':c.accepted?'connecting':'waiting',source:c.source,startedAt:c.startedAt,connectedAt:c.connectedAt,shield:c.relay?.mode==='shield',finalizing:!!c.ended&&!c.finalized,segments:c.segments,reason:c.reason||''});
  const available=()=>[...agents].some(a=>a.readyState===Ws.OPEN);
  function resetDay(){const date=new Date().toISOString().slice(0,10);if(date!==dailyDate){dailyDate=date;dailySeconds=0;}}
  const list=()=>{const rows=[...calls.values()].filter(c=>!c.ended||Date.now()-c.ended<3600000).map(snapshot);for(const agent of agents)send(agent,{event:'calls',calls:rows});};
  function protect(c,reason,decision,transcript='',source='manual'){if(!c.accepted||c.ended)return;const changed=source==='ai'?c.relay.enableShield({category:decision?.category,protectiveTakeoverRecommended:decision?.directAbuse===true&&decision?.scope==='direct_attack',evidence:decision?.evidence},transcript):c.relay.protectManually(source,reason);if(!changed)return;c.reason=reason;send(c.agent,{event:'protection',callId:c.id,enabled:true,reason});list();}
  async function end(c,reason='통화가 종료되었습니다.'){
    if(!c||c.ended)return;c.ended=Date.now();clearTimeout(c.timer);clearTimeout(c.waitTimer);c.reason=reason;
    send(c.socket,{event:'ended',callId:c.id,reason});send(c.agent,{event:'ended',callId:c.id,reason});
    c.relay?.end();list();
    c.socket.close(1000);
    try{await c.analysis?.stop();}catch{c.reason+=' 일부 내용을 정리하지 못했습니다.';send(c.agent,{event:'analysis_error',callId:c.id,message:c.reason});}
    finally{c.finalized=true;list();}
  }
  async function accept(c,agent){
    if(!c||c.ended||c.accepted||active().some(other=>other.accepted)){
      send(agent,{event:'accept_error',callId:c?.id,message:'이미 연결 중이거나 종료된 통화입니다. 상담 목록을 확인해 주세요.'});return;
    }
    c.accepted=true;c.agent=agent;clearTimeout(c.waitTimer);c.startedAt=new Date().toISOString();
    c.relay=new FilterRelay({delayMs:playbackDelayMs,caller:event=>send(c.socket,event),officer:event=>send(agent,{...event,callId:c.id}),onCallerAudio:(payload,pcm)=>{if(pcm&&c.analysis?.pushPcm)c.analysis.pushPcm(pcm);else c.analysis?.push(Buffer.from(payload,'base64'));},onAudioError:()=>protect(c,'음성 재생 버퍼 확인 필요',undefined,'','analysis_error')});c.relay.start(c.id);
    send(agent,{event:'connecting',callId:c.id});list();
    try{c.analysis=analysisFactory({key,model,onText:event=>{if(c.finalized)return;c.segments.push({...event,at:new Date().toISOString()});send(agent,{event:'neutral_text',callId:c.id,...event});list();},onShield:(decision,transcript)=>protect(c,'욕설·위협 표현 감지',decision,transcript,'ai'),onError:message=>{protect(c,'분석 확인 필요',undefined,'','analysis_error');send(agent,{event:'analysis_error',callId:c.id,message});},onProcessing:turnId=>send(agent,{event:'processing',callId:c.id,turnId}),onSettled:turnId=>send(agent,{event:'processing_done',callId:c.id,turnId})});await c.analysis.start();if(c.ended){await c.analysis.stop();return;}c.ready=true;c.connectedAt=new Date().toISOString();send(c.socket,{event:'active',callId:c.id,connectedAt:c.connectedAt});send(agent,{event:'active',callId:c.id,connectedAt:c.connectedAt});c.timer=setTimeout(()=>void end(c,'상담 시간이 종료되었습니다.'),maxCallSeconds*1000);list();}
    catch{await end(c,'음성 분석 서버에 연결하지 못했습니다.');}
  }
  function incoming(socket,source){
    resetDay();
    if(!available()||active().length>=2||dailySeconds>=maxDailySeconds){send(socket,{event:'ended',reason:dailySeconds>=maxDailySeconds?'오늘의 음성 상담 이용 한도에 도달했습니다.':'현재 연결 가능한 담당자가 없습니다.'});socket.close(1000);return null;}
    const c={id:randomUUID(),source,socket,segments:[],accepted:false,ready:false,ended:null,startedAt:new Date().toISOString(),frames:0,windowAt:Date.now(),windowFrames:0};calls.set(c.id,c);socket.callId=c.id;
    c.waitTimer=setTimeout(()=>void end(c,'담당자 연결 대기 시간이 지났습니다.'),waitSeconds*1000);
    send(socket,{event:'waiting',callId:c.id});list();return c;
  }
  function frame(c,payload,speaker,format){
    const pcm=format==='pcm16-16000';if(format&& !pcm)return;
    if(!c?.ready||c.ended||typeof payload!=='string'||payload.length!==(pcm?856:216)||!/^[A-Za-z0-9+/]+={0,2}$/.test(payload))return;
    const bytes=Buffer.from(payload,'base64');if(bytes.length!==(pcm?640:160))return;
    const now=Date.now();if(now-c.windowAt>1000){c.windowAt=now;c.windowFrames=0;}if(++c.windowFrames>180){void end(c,'통화 데이터 속도를 초과했습니다.');return;}
    if(speaker==='caller'){
      resetDay();dailySeconds+=.02;if(dailySeconds>maxDailySeconds){void end(c,'오늘의 음성 상담 이용 한도에 도달했습니다.');return;}
      c.relay.fromCaller(pcm?pcm16ToMuLaw(bytes).toString('base64'):payload,pcm?bytes:undefined);
    }else c.relay.fromOfficer(pcm?pcm16ToMuLaw(bytes).toString('base64'):payload);
  }
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(url.pathname==='/health'&&req.method==='GET'){resetDay();res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ready:true,transport:'web',officers:agents.size,active:active().length,acceptingCalls:available()&&active().length<2&&dailySeconds<maxDailySeconds}));}
    res.writeHead(404);res.end();
  });
  const wss=new Ws.WebSocketServer({noServer:true,maxPayload:18000,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path!=='/connect'||!origins.includes(req.headers.origin)){socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',socket=>{
    let role=null,consumed=false;socket.alive=true;const authTimer=setTimeout(()=>socket.close(1008),8000);
    socket.on('pong',()=>{socket.alive=true;});
    socket.on('error',()=>{});
    socket.on('message',bytes=>{
      try{
        const e=JSON.parse(bytes.toString());
        if(!role){
          const token=e.event==='auth'?e.token:null;
          const claims=verifyTicket(secret,token);
          if(claims.role==='carrier'||usedTickets.has(claims.nonce))throw new Error('Rejected');
          usedTickets.set(claims.nonce,claims.exp);role=claims.role;clearTimeout(authTimer);
          if(role==='staff'){agents.add(socket);send(socket,{event:'ready'});list();}
          else{consumed=true;incoming(socket,claims.demo===true?'demo':'browser');}
          return;
        }
        if(role==='staff'){
          const c=calls.get(e.callId);
          if(e.event==='accept'){void accept(c,socket);return;}
          if(!c||c.agent!==socket)return;
          if(e.event==='media')frame(c,e.payload,'officer',e.format);
          if(e.event==='hangup')void end(c);
          if(e.event==='shield')protect(c,'담당자 보호 모드');
          if(e.event==='resume'&&!c.ended){if(c.analysis?.canResume&&!c.analysis.canResume()){send(socket,{event:'analysis_error',callId:c.id,message:'음성 분석 연결이 복구된 뒤 다시 연결해 주세요.'});return;}c.relay?.resume();c.reason='';send(socket,{event:'protection',callId:c.id,enabled:false});list();}
        }else{
          const c=calls.get(socket.callId);
          if(e.event==='media')frame(c,e.payload,'caller',e.format);
          if(e.event==='hangup'||e.event==='stop')void end(c);
        }
      }catch{send(socket,{event:'error',message:'통화 연결을 다시 시작해 주세요.'});socket.close(1008);}
    });
    socket.on('close',()=>{clearTimeout(authTimer);agents.delete(socket);if(consumed)void end(calls.get(socket.callId),'상대방 연결이 종료되었습니다.');else for(const c of active())if(c.agent===socket||!available())void end(c,'담당자 연결이 종료되었습니다.');list();});
  });
  const cleanup=setInterval(()=>{for(const[id,c]of calls)if(c.ended&&Date.now()-c.ended>3600000)calls.delete(id);for(const[n,e]of usedTickets)if(e*1000<Date.now())usedTickets.delete(n);},60000);cleanup.unref();
  const heartbeat=setInterval(()=>{for(const s of wss.clients){if(!s.alive){s.terminate();continue;}s.alive=false;s.ping();}},heartbeatMs);heartbeat.unref();
  return {server,wss,calls,close:async()=>{clearInterval(cleanup);clearInterval(heartbeat);await Promise.all(active().map(c=>end(c)));for(const s of wss.clients)s.terminate();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const origins=(process.env.PHONE_ALLOWED_ORIGINS||'https://shield-solve-staff.vercel.app,https://shield-and-solve.vercel.app,http://127.0.0.1:3100').split(',').map(s=>s.trim()).filter(Boolean);
  const app=createPhoneServer({secret:process.env.PHONE_BRIDGE_SECRET,key:process.env.SERVICE_OPENAI_API_KEY||process.env.OPENAI_API_KEY,geminiKey:process.env.GEMINI_API_KEY,analysisProvider:process.env.PHONE_ANALYSIS_PROVIDER||'gemini',textProvider:process.env.PHONE_TEXT_PROVIDER||'gemini',geminiModel:process.env.PHONE_GEMINI_MODEL||'gemini-3.5-flash-lite',transcriptionModel:process.env.PHONE_GEMINI_TRANSCRIPTION_MODEL||'gemini-3.5-transcribe-live',safetyIntervalMs:Number(process.env.PHONE_SAFETY_INTERVAL_MS||400),playbackDelayMs:Number(process.env.PHONE_AUDIO_DELAY_MS||2500),origins,model:process.env.SERVICE_OPENAI_MODEL||'gpt-6-luna'});
  app.server.listen(Number(process.env.PHONE_PORT||4318),'127.0.0.1',()=>console.log('Phone bridge listening on 127.0.0.1:4318'));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close().then(()=>process.exit(0)));
}
