import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
import {telephoneAudio} from '../phone/audio.mjs';

const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
const sockets=[],start=performance.now();
const report={testedAt:new Date().toISOString(),synthetic:true,hardwareMicrophonesTested:false,actualTelephoneNetworkTested:false,transport:'production websites /api/phone → public WSS → real STT and AI',checks:{},timing:{},texts:[]};
const elapsed=()=>Math.round(performance.now()-start);
async function until(check,label,timeout=45000){const at=Date.now();while(!check()){if(Date.now()-at>timeout)throw new Error(label+'_timeout');await delay(10);}}
async function connect(role,origin){
  const response=await fetch(origin+'/api/phone',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({demo:true}),signal:AbortSignal.timeout(15000)});
  const settings=await response.json();if(!response.ok||settings.role!==role)throw new Error('website_ticket_'+response.status);
  const ws=new Ws(settings.url,{origin}),events=[];sockets.push(ws);ws.on('error',()=>{});
  ws.on('message',data=>events.push({...JSON.parse(data),receivedAtMs:elapsed()}));
  await until(()=>ws.readyState===Ws.OPEN,'websocket',15000);
  ws.send(JSON.stringify({event:'auth',token:settings.token}));
  return{ws,events,send:event=>ws.send(JSON.stringify(event))};
}
async function play(client,name){
  const wave=telephoneAudio(await readFile('public/demo-audio/'+name+'.wav')),startedAtMs=elapsed(),at=performance.now();
  for(let pos=0;pos<wave.length+9600;pos+=160){
    await delay(Math.max(0,at+pos/8-performance.now()));
    const frame=Buffer.alloc(160,255);if(pos<wave.length)wave.copy(frame,0,pos,Math.min(pos+160,wave.length));
    client.send({event:'media',payload:frame.toString('base64')});
  }
  return{startedAtMs,audioEndedAtMs:startedAtMs+wave.length/8};
}
let officer,caller,callId;
const textEvents=()=>officer.events.filter(e=>e.event==='neutral_text');
const heard=()=>officer.events.filter(e=>e.event==='media').length;
try{
  officer=await connect('staff','https://shield-solve-staff.vercel.app');
  await until(()=>officer.events.some(e=>e.event==='ready'),'officer_ready');
  caller=await connect('caller','https://shield-and-solve.vercel.app');
  await until(()=>caller.events.some(e=>e.event==='waiting'),'caller_waiting');
  callId=caller.events.find(e=>e.event==='waiting').callId;
  const acceptedAt=elapsed();officer.send({event:'accept',callId});
  await until(()=>caller.events.some(e=>e.event==='active')&&officer.events.some(e=>e.event==='active'&&e.callId===callId),'call_active');
  report.checks.connection=true;report.timing.acceptToActiveMs=elapsed()-acceptedAt;

  const initial=await play(caller,'normal');
  await until(()=>textEvents().some(e=>/현장/.test(e.text)&&/쓰레기|수거/.test(e.text)),'normal_request');
  report.checks.normalAudioDelivered=heard()>0;
  report.checks.normalNotShielded=!officer.events.some(e=>e.event==='protection'&&e.enabled);
  report.checks.normalRequirementsPreserved=true;
  report.timing.normalTextAfterAudioEndMs=Math.round(textEvents().at(-1).receivedAtMs-initial.audioEndedAtMs);

  let prior=textEvents().length;
  const abuse=await play(caller,'profanity');
  await until(()=>officer.events.some(e=>e.event==='protection'&&e.enabled&&e.reason==='욕설·위협 표현 감지'),'automatic_shield');
  const protection=officer.events.find(e=>e.event==='protection'&&e.enabled&&e.reason==='욕설·위협 표현 감지');
  await until(()=>textEvents().slice(prior).some(e=>/쓰레기/.test(e.text)&&/집\s*앞/.test(e.text)),'abuse_neutral_text');
  report.checks.automaticShield=true;
  report.checks.queuedAudioCleared=officer.events.some(e=>e.event==='clear');
  const cleaned=textEvents().slice(prior);
  report.checks.abuseRemovedAndRequestKept=cleaned.length>0&&cleaned.every(e=>!/씨발|시발|그따위/.test(e.text));
  report.timing.abuseAudioStartToShieldMs=protection.receivedAtMs-abuse.startedAtMs;
  report.timing.abuseAudioEndToTextMs=Math.round(cleaned.at(-1).receivedAtMs-abuse.audioEndedAtMs);

  // Drain any frame already in flight before checking that protection blocks all new audio.
  await delay(200);const receivedBefore=heard();prior=textEvents().length;
  const followup=await play(caller,'normal');
  await until(()=>textEvents().slice(prior).some(e=>/현장/.test(e.text)&&/수거/.test(e.text)),'protected_followup');
  report.checks.callerAudioBlocked=heard()===receivedBefore;
  report.checks.analysisContinuesWhileProtected=true;
  report.timing.protectedTextAfterAudioEndMs=Math.round(textEvents().at(-1).receivedAtMs-followup.audioEndedAtMs);

  const outgoing=telephoneAudio(await readFile('public/demo-audio/normal.wav'));
  const payload=outgoing.subarray(800,960).toString('base64'),before=caller.events.length;
  officer.send({event:'media',callId,payload});
  await until(()=>caller.events.slice(before).some(e=>e.event==='media'&&e.media?.payload===payload),'officer_voice');
  report.checks.officerVoiceStillDelivered=true;
  report.checks.textVisibleOnlyToOfficer=!caller.events.some(e=>e.event==='neutral_text');

  officer.send({event:'hangup',callId});
  await until(()=>caller.events.some(e=>e.event==='ended')&&officer.events.some(e=>e.event==='ended'&&e.callId===callId),'hangup');
  await until(()=>officer.events.filter(e=>e.event==='calls').at(-1)?.calls?.some(c=>c.id===callId&&c.status==='ended'&&!c.finalizing),'finalization');
  report.checks.cleanHangup=true;
  report.checks.noAnalysisErrors=!officer.events.some(e=>e.event==='analysis_error');
  report.passed=Object.values(report.checks).every(Boolean);
}catch(error){report.passed=false;report.error=error.message;}
finally{
  report.texts=officer?textEvents().map(e=>({text:e.text,status:e.status,receivedAtMs:e.receivedAtMs})):[];
  report.errors=officer?.events.filter(e=>['analysis_error','error'].includes(e.event)).map(e=>e.message)||[];
  if(callId&&officer?.ws.readyState===Ws.OPEN)officer.send({event:'hangup',callId});
  for(const ws of sockets)ws.terminate();
  await mkdir('outputs/phone-runtime',{recursive:true});
  await writeFile('outputs/phone-runtime/verification-full-flow.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
if(!report.passed)process.exitCode=1;
