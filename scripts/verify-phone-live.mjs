import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {telephoneAudio} from '../phone/audio.mjs';
import {parseEnv} from 'node:util';
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
const carrierMode=process.argv.includes('--carrier');
async function until(fn,timeout=30000){const at=Date.now();while(!fn()){if(Date.now()-at>timeout)throw new Error('Verification_timeout');await delay(10);}}
const sockets=[];
async function connect(role,origin){const response=await fetch(origin+'/api/phone',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({demo:true})});const settings=await response.json();if(!response.ok||settings.role!==role)throw new Error('Website_ticket_'+response.status);const s=new Ws(settings.url,{origin});sockets.push(s);const events=[];s.on('message',data=>events.push(JSON.parse(data)));s.on('error',()=>{});await until(()=>s.readyState===Ws.OPEN,15000);s.send(JSON.stringify({event:'auth',token:settings.token}));return{s,events,send:e=>s.send(JSON.stringify(e))};}
async function connectCarrier(){
 const config=parseEnv(await readFile('.env.phone.local','utf8'));
 const hook=new URL('https://shield-solve-staff.vercel.app/api/phone/incoming');hook.searchParams.set('token',config.PHONE_PROVIDER_TOKEN);
 const response=await fetch(hook,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'CallId=CA_SYNTHETIC_VERIFICATION'});
 const xml=await response.text();const url=xml.match(/<Stream url="([^"]+)"/)?.[1],token=xml.match(/<Parameter name="token" value="([^"]+)"/)?.[1];
 if(!response.ok||!url||!token)throw new Error('Production_carrier_webhook_unavailable');
 const s=new Ws(url),events=[];sockets.push(s);s.on('message',data=>events.push(JSON.parse(data)));s.on('error',()=>{});await until(()=>s.readyState===Ws.OPEN,15000);
 s.send(JSON.stringify({event:'connected',protocol:'Call',version:'1.0.0'}));s.send(JSON.stringify({event:'start',start:{streamId:'MZ_SYNTHETIC',callId:'CA_SYNTHETIC_VERIFICATION',accountId:'AC_SYNTHETIC',tracks:['inbound'],mediaFormat:{encoding:'audio/x-mulaw',sampleRate:8000,channels:1},customParameters:{token}}}));
 return{s,events,send:event=>s.send(JSON.stringify(event.event==='media'?{event:'media',media:{track:'inbound',payload:event.payload}}:event))};
}
const result={synthetic:true,actualTelephoneNetworkTested:false,transport:carrierMode?'production incoming webhook, public carrier WSS protocol emulator, real STT/AI':'production website tickets, public WSS tunnel, real STT/AI, protocol clients (not hardware microphones)',checks:{}};
let observedAgent;
try{
 const agent=await connect('staff','https://shield-solve-staff.vercel.app');observedAgent=agent;await until(()=>agent.events.some(e=>e.event==='ready'));
 const caller=carrierMode?await connectCarrier():await connect('caller','https://shield-and-solve.vercel.app');
 const waiting=()=>agent.events.filter(e=>e.event==='calls').at(-1)?.calls?.find(c=>c.status==='waiting'&&c.source===(carrierMode?'phone':'demo'));
 await until(()=>waiting());const id=waiting().id;agent.send({event:'accept',callId:id});await until(()=>agent.events.some(e=>e.event==='active'&&e.callId===id));
 const wav=telephoneAudio(await readFile('outputs/phone-handoff-verification/cloud-input/profanity.wav'));const started=performance.now();
 for(let pos=0;pos<wav.length+9600;pos+=160){await delay(Math.max(0,started+pos/8-performance.now()));const frame=Buffer.alloc(160,255);if(pos<wav.length)wav.copy(frame,0,pos,Math.min(pos+160,wav.length));caller.send({event:'media',payload:frame.toString('base64')});}
 // VAD may split one recording at a natural pause. Judge the full delivered request,
 // not an assumed one-recording/one-segment mapping.
 const delivered=()=>agent.events.filter(e=>e.event==='neutral_text').map(e=>e.text).join('\n');
 await until(()=>/집\s*앞/.test(delivered())&&/쓰레기/.test(delivered())||agent.events.some(e=>e.event==='analysis_error'));
 result.text=delivered();result.errors=agent.events.filter(e=>e.event==='analysis_error').map(e=>e.message);
 result.checks.neutralText=/집\s*앞/.test(result.text)&&/쓰레기/.test(result.text)&&!/씨발|시발/.test(result.text);
 result.checks.automaticShield=agent.events.some(e=>e.event==='protection'&&e.enabled&&e.reason==='욕설·위협 표현 감지');
 const protectedCount=agent.events.filter(e=>e.event==='media').length,priorSegments=agent.events.filter(e=>e.event==='neutral_text').length;
 const followup=telephoneAudio(await readFile('outputs/phone-handoff-verification/cloud-input/normal.wav'));const nextAt=performance.now();
 result.stage='protected_followup';
 for(let pos=0;pos<followup.length+9600;pos+=160){await delay(Math.max(0,nextAt+pos/8-performance.now()));const frame=Buffer.alloc(160,255);if(pos<followup.length)followup.copy(frame,0,pos,Math.min(pos+160,followup.length));caller.send({event:'media',payload:frame.toString('base64')});}
 await until(()=>agent.events.filter(e=>e.event==='neutral_text').slice(priorSegments).some(e=>/현장/.test(e.text)));
 result.checks.nextTurnWhileProtected=agent.events.filter(e=>e.event==='neutral_text').slice(priorSegments).some(e=>/현장/.test(e.text))&&agent.events.filter(e=>e.event==='media').length===protectedCount;
 result.stage='duplex_and_hangup';
 const before=agent.events.filter(e=>e.event==='media').length,otherBefore=caller.events.filter(e=>e.event==='media').length;
 const payload=wav.subarray(800,960).toString('base64');caller.send({event:'media',payload});agent.send({event:'media',callId:id,payload});await until(()=>caller.events.filter(e=>e.event==='media').length>otherBefore);await delay(150);
 result.checks.officerMic=caller.events.at(-1).media?.payload===payload;result.checks.incomingBlocked=agent.events.filter(e=>e.event==='media').length===before;
 result.checks.textPrivate=!caller.events.some(e=>e.event==='neutral_text');
 agent.send({event:'hangup',callId:id});await until(()=>carrierMode?caller.s.readyState===Ws.CLOSED:caller.events.some(e=>e.event==='ended'));result.checks.hangup=true;
 if(carrierMode)result.checks.carrierProtocolOnly=caller.events.every(e=>['media','clear','mark','dtmf'].includes(e.event));
 result.stage='complete';
 result.passed=Object.values(result.checks).every(Boolean);console.log(JSON.stringify(result));
}catch(error){result.passed=false;result.error=String(error.message).slice(0,120);result.observedText=observedAgent?.events.filter(e=>e.event==='neutral_text').map(e=>({text:e.text,facts:e.facts}));result.observedErrors=observedAgent?.events.filter(e=>['analysis_error','ended','error'].includes(e.event));console.log(JSON.stringify(result));}finally{for(const s of sockets)s.terminate();await writeFile('outputs/phone-runtime/'+(carrierMode?'verification-carrier-live':'verification-live')+'.json',JSON.stringify(result,null,2));}
if(!result.passed)process.exitCode=1;
