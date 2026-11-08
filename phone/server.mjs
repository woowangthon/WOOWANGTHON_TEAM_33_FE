import http from 'node:http';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {verifyTicket,signTicket} from './token.mjs';
import {FilterRelay} from './filter-relay.mjs';
import {CallAnalysis} from './analysis.mjs';
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
const send=(socket,event)=>{
  // Carrier sockets accept media protocol messages, never browser control or private text events.
  if(socket?.carrier&&!['media','clear','mark','dtmf'].includes(event.event))return;
  if(socket?.readyState===Ws.OPEN&&socket.bufferedAmount<128000)socket.send(JSON.stringify(event));
};
const equal=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length>0&&x.length===y.length&&timingSafeEqual(x,y);};
const xml=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');

export function createPhoneServer({secret,key,providerToken,publicUrl,origins,model='gpt-6-luna',analysisFactory=options=>new CallAnalysis(options),maxCallSeconds=600}){
  if(!secret||!key)throw new Error('Phone_server_configuration_missing');
  const agents=new Set(),calls=new Map(),usedTickets=new Map();let dailyDate='',dailySeconds=0;
  const active=()=>[...calls.values()].filter(c=>!c.ended);
  const snapshot=c=>({id:c.id,status:c.ended?'ended':c.accepted?'active':'waiting',source:c.source,startedAt:c.startedAt,shield:c.relay?.mode==='shield',finalizing:!!c.ended&&!c.finalized,segments:c.segments,reason:c.reason||''});
  const list=()=>{const rows=[...calls.values()].filter(c=>!c.ended||Date.now()-c.ended<3600000).map(snapshot);for(const agent of agents)send(agent,{event:'calls',calls:rows});};
  function protect(c,reason){if(!c.accepted||c.ended)return;c.relay.enableShield({category:'threat',protectiveTakeoverRecommended:true,evidence:'보호'},'보호');c.reason=reason;send(c.agent,{event:'protection',callId:c.id,enabled:true,reason});list();}
  async function end(c,reason='통화가 종료되었습니다.'){
    if(!c||c.ended)return;c.ended=Date.now();clearTimeout(c.timer);clearTimeout(c.waitTimer);c.reason=reason;
    send(c.socket,{event:'ended',callId:c.id,reason});send(c.agent,{event:'ended',callId:c.id,reason});
    c.relay?.end();list();
    // End the paid telephone leg immediately; finish outstanding text analysis separately.
    if(c.source==='phone')c.socket.close(1000);
    await c.analysis?.stop();c.finalized=true;list();
  }
  async function accept(c,agent){
    if(!c||c.ended||c.accepted||active().some(other=>other.accepted))return;
    c.accepted=true;c.agent=agent;clearTimeout(c.waitTimer);c.startedAt=new Date().toISOString();
    c.relay=new FilterRelay({caller:event=>send(c.socket,event),officer:event=>send(agent,{...event,callId:c.id}),onCallerAudio:payload=>c.analysis?.push(Buffer.from(payload,'base64'))});c.relay.start(c.id);
    c.analysis=analysisFactory({key,model,onText:event=>{if(c.finalized)return;c.segments.push({...event,at:new Date().toISOString()});send(agent,{event:'neutral_text',callId:c.id,...event});list();},onShield:()=>protect(c,'욕설·위협 표현 감지'),onError:message=>{protect(c,'분석 확인 필요');send(agent,{event:'analysis_error',callId:c.id,message});},onProcessing:turnId=>send(agent,{event:'processing',callId:c.id,turnId})});
    send(agent,{event:'connecting',callId:c.id});list();
    try{await c.analysis.start();if(c.ended){await c.analysis.stop();return;}c.ready=true;send(c.socket,{event:'active',callId:c.id});send(agent,{event:'active',callId:c.id});c.timer=setTimeout(()=>void end(c,'상담 시간이 종료되었습니다.'),maxCallSeconds*1000);list();}
    catch{await end(c,'음성 분석 서버에 연결하지 못했습니다.');}
  }
  function incoming(socket,source){
    const available=[...agents].some(a=>a.readyState===Ws.OPEN);
    if(!available||active().length>=2){send(socket,{event:'ended',reason:'현재 연결 가능한 담당자가 없습니다.'});socket.close(1000);return null;}
    const c={id:randomUUID(),source,socket,segments:[],accepted:false,ready:false,ended:null,startedAt:new Date().toISOString(),frames:0,windowAt:Date.now(),windowFrames:0};calls.set(c.id,c);socket.callId=c.id;
    c.waitTimer=setTimeout(()=>void end(c,'담당자 연결 대기 시간이 지났습니다.'),60000);
    send(socket,{event:'waiting',callId:c.id});list();return c;
  }
  function frame(c,payload,speaker){
    if(!c?.ready||c.ended||typeof payload!=='string'||payload.length!==216||!/^[A-Za-z0-9+/]+={0,2}$/.test(payload))return;
    const bytes=Buffer.from(payload,'base64');if(bytes.length!==160)return;
    const now=Date.now();if(now-c.windowAt>1000){c.windowAt=now;c.windowFrames=0;}if(++c.windowFrames>180){void end(c,'통화 데이터 속도를 초과했습니다.');return;}
    if(speaker==='caller'){
      const date=new Date().toISOString().slice(0,10);if(date!==dailyDate){dailyDate=date;dailySeconds=0;}
      dailySeconds+=.02;if(dailySeconds>1800){void end(c,'오늘의 음성 상담 이용 한도에 도달했습니다.');return;}
      c.relay.fromCaller(payload);
    }else c.relay.fromOfficer(payload);
  }
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(url.pathname==='/health'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ready:true,officers:agents.size,active:active().length}));}
    if(url.pathname==='/provider/voice'&&req.method==='POST'&&equal(url.searchParams.get('token'),providerToken)){
      // The configured webhook capability only authorizes a fresh, single-use media session.
      let body='';for await(const chunk of req){body+=chunk;if(body.length>16000){res.writeHead(413);res.end();return;}}
      if(!publicUrl||!agents.size){res.setHeader('Content-Type','application/xml');return res.end('<Response><Say>지금은 상담 연결이 어렵습니다. 잠시 후 다시 전화해 주세요.</Say><Hangup/></Response>');}
      const token=signTicket(secret,{role:'carrier'},90),stream=new URL('/carrier',publicUrl);stream.protocol='wss:';
      res.setHeader('Content-Type','application/xml');return res.end(`<Response><Say language="ko-KR">민원 상담을 위해 통화 내용이 자동으로 분석됩니다. 담당자에게 연결합니다.</Say><Connect><Stream url="${xml(stream.toString())}" track="inbound"><Parameter name="token" value="${xml(token)}"/></Stream></Connect><Hangup/></Response>`);
    }
    res.writeHead(404);res.end();
  });
  const wss=new Ws.WebSocketServer({noServer:true,maxPayload:18000,perMessageDeflate:false});
  server.on('upgrade',(req,socket,head)=>{
    const path=new URL(req.url,'http://localhost').pathname;
    if(!['/connect','/carrier'].includes(path)||(path==='/connect'&&!origins.includes(req.headers.origin))){socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>{ws.carrier=path==='/carrier';wss.emit('connection',ws);});
  });
  wss.on('connection',socket=>{
    let role=null,consumed=false;const authTimer=setTimeout(()=>socket.close(1008),8000);
    socket.on('error',()=>{});
    socket.on('message',bytes=>{
      try{
        const e=JSON.parse(bytes.toString());
        if(!role){
          if(socket.carrier&&e.event==='connected')return;
          const token=socket.carrier&&e.event==='start'?e.start?.customParameters?.token:e.event==='auth'?e.token:null;
          const claims=verifyTicket(secret,token);
          if((socket.carrier&&claims.role!=='carrier')||(!socket.carrier&&claims.role==='carrier')||usedTickets.has(claims.nonce))throw new Error('Rejected');
          if(socket.carrier&&(e.start?.mediaFormat?.encoding!=='audio/x-mulaw'||Number(e.start?.mediaFormat?.sampleRate)!==8000||Number(e.start?.mediaFormat?.channels)!==1))throw new Error('Wrong_codec');
          usedTickets.set(claims.nonce,claims.exp);role=claims.role;clearTimeout(authTimer);
          if(role==='staff'){agents.add(socket);send(socket,{event:'ready'});list();}
          else{consumed=true;incoming(socket,role==='carrier'?'phone':claims.demo===true?'demo':'browser');}
          return;
        }
        if(role==='staff'){
          const c=calls.get(e.callId);
          if(e.event==='accept'){void accept(c,socket);return;}
          if(!c||c.agent!==socket)return;
          if(e.event==='media')frame(c,e.payload,'officer');
          if(e.event==='hangup')void end(c);
          if(e.event==='shield')protect(c,'담당자 보호 모드');
          if(e.event==='resume'&&!c.ended){c.relay?.resume();c.reason='';send(socket,{event:'protection',callId:c.id,enabled:false});list();}
        }else{
          const c=calls.get(socket.callId);
          if(e.event==='media')frame(c,socket.carrier?e.media?.payload:e.payload,'caller');
          if(e.event==='hangup'||e.event==='stop')void end(c);
        }
      }catch{send(socket,{event:'error',message:'통화 연결을 다시 시작해 주세요.'});socket.close(1008);}
    });
    socket.on('close',()=>{clearTimeout(authTimer);agents.delete(socket);if(consumed)void end(calls.get(socket.callId),'상대방 연결이 종료되었습니다.');else for(const c of active())if(c.agent===socket)void end(c,'담당자 연결이 종료되었습니다.');list();});
  });
  const cleanup=setInterval(()=>{for(const[id,c]of calls)if(c.ended&&Date.now()-c.ended>3600000)calls.delete(id);for(const[n,e]of usedTickets)if(e*1000<Date.now())usedTickets.delete(n);},60000);cleanup.unref();
  return {server,wss,calls,close:async()=>{clearInterval(cleanup);await Promise.all(active().map(c=>end(c)));for(const s of wss.clients)s.terminate();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const origins=(process.env.PHONE_ALLOWED_ORIGINS||'https://shield-solve-staff.vercel.app,https://shield-and-solve.vercel.app,http://127.0.0.1:3100').split(',').map(s=>s.trim()).filter(Boolean);
  const app=createPhoneServer({secret:process.env.PHONE_BRIDGE_SECRET,key:process.env.SERVICE_OPENAI_API_KEY||process.env.OPENAI_API_KEY,providerToken:process.env.PHONE_PROVIDER_TOKEN,publicUrl:process.env.PHONE_BRIDGE_URL,origins,model:process.env.SERVICE_OPENAI_MODEL||'gpt-6-luna'});
  app.server.listen(Number(process.env.PHONE_PORT||4318),'127.0.0.1',()=>console.log('Phone bridge listening on 127.0.0.1:4318'));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void app.close().then(()=>process.exit(0)));
}
