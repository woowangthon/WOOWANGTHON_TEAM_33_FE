// Licensed text read with Windows TTS -> production tickets/WSS -> actual STT/AI.
// Source readings remain separate turns. They are not an original citizen recording.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {telephoneAudio} from '../phone/audio.mjs';
if(!process.argv.includes('--live'))throw Error('Use --live for the billable production voice check');
const folder=resolve(process.env.PHONE_LICENSED_AUDIO_DIR||'../phone-licensed-check');
const manifest=JSON.parse((await readFile(resolve(folder,'samples.json'),'utf8')).replace(/^\uFEFF/,''));
if(manifest.syntheticAudio!==true||manifest.sourceTextModified!==false||manifest.commentsSource.license!=='MIT'||manifest.complaintsSource.license!=='이용허락범위 제한 없음')throw Error('Audio provenance missing');
const waves=new Map();for(const s of manifest.samples){const wav=await readFile(resolve(folder,s.path));if(createHash('sha256').update(wav).digest('hex')!==s.sha256)throw Error('Audio hash mismatch');waves.set(s.name,telephoneAudio(wav));}
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws'),sockets=[],start=performance.now();
const report={startedAt:new Date().toISOString(),syntheticAudio:true,originalCallRecording:false,sourceTextModified:false,hardwareMicrophoneTested:false,hardwareSpeakerTested:false,actualTelephoneNetworkTested:false,transport:'production /api/phone tickets → public WSS → real STT and AI → officer text/audio frames',sources:manifest,checks:{},timing:{},steps:[],texts:[],errors:[]};
const elapsed=()=>Math.round(performance.now()-start),destination=resolve(folder,'result-'+Date.now()+'.json');
const save=()=>writeFile(destination,JSON.stringify(report,null,2));
async function until(check,label,timeout=60000){const at=Date.now();while(!check()){if(Date.now()-at>timeout)throw Error(label+'_timeout');if(report.errors.length)throw Error('call_analysis_error');await delay(20);}}
async function connect(role,origin){
 const response=await fetch(origin+'/api/phone',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({demo:true}),signal:AbortSignal.timeout(15000)}),settings=await response.json();
 if(!response.ok||settings.role!==role)throw Error('website_ticket_'+response.status);
 const ws=new Ws(settings.url,{origin}),events=[],client={ws,events,frames:0,lastPayload:'',send:e=>ws.send(JSON.stringify(e))};sockets.push(ws);ws.on('error',()=>{});
 ws.on('message',bytes=>{const e=JSON.parse(bytes);if(e.event==='media'){client.frames++;client.lastPayload=e.payload||e.media?.payload;return;}events.push({...e,receivedAtMs:elapsed()});if(['analysis_error','error'].includes(e.event))report.errors.push({role,event:e.event,message:e.message||e.reason,atMs:elapsed()});});
 await until(()=>ws.readyState===Ws.OPEN,'websocket',15000);client.send({event:'auth',token:settings.token});return client;
}
let officer,caller,callId;
const textEvents=()=>officer.events.filter(e=>e.event==='neutral_text');
const protections=()=>officer.events.filter(e=>e.event==='protection');
async function play(client,name){
 const wave=waves.get(name),startedAtMs=elapsed(),at=performance.now();let framesSent=0;
 for(let pos=0;pos<wave.length+12000;pos+=160){await delay(Math.max(0,at+pos/8-performance.now()));const frame=Buffer.alloc(160,255);if(pos<wave.length)wave.copy(frame,0,pos,Math.min(pos+160,wave.length));client.send({event:'media',...(client===officer?{callId}:{}),payload:frame.toString('base64')});framesSent++;}
 return{sourceName:name,startedAtMs,audioEndedAtMs:startedAtMs+wave.length/8,audioSeconds:wave.length/8000,framesSent};
}
const wordsKept=(events,name)=>manifest.samples.find(s=>s.name===name).required.every(w=>events.some(e=>e.text.includes(w)));
async function step(name,action){console.log(name);const row={name,atMs:elapsed(),status:'running'};report.steps.push(row);await save();await action(row);row.status='passed';await save();}
await mkdir(dirname(destination),{recursive:true});await save();
try{
 const health=await(await fetch('http://127.0.0.1:4318/health',{signal:AbortSignal.timeout(3000)})).json();if(health.officers!==0||health.active!==0)throw Error('Existing session present; test stopped to avoid interference');
 await step('connect',async()=>{officer=await connect('staff','https://shield-solve-staff.vercel.app');await until(()=>officer.events.some(e=>e.event==='ready'),'officer_ready');caller=await connect('caller','https://shield-and-solve.vercel.app');await until(()=>caller.events.some(e=>e.event==='waiting'),'caller_waiting');callId=caller.events.find(e=>e.event==='waiting').callId;const accepted=elapsed();officer.send({event:'accept',callId});await until(()=>caller.events.some(e=>e.event==='active')&&officer.events.some(e=>e.event==='active'&&e.callId===callId),'active');report.checks.connection=true;report.timing.acceptToActiveMs=elapsed()-accepted;});
 await step('normal_request',async row=>{const before=officer.frames,prior=textEvents().length;row.audio=await play(caller,'normal');await until(()=>wordsKept(textEvents().slice(prior),'normal'),'normal_facts');report.checks.normalAudioDelivered=officer.frames>before;report.checks.normalNotShielded=!protections().some(e=>e.enabled);report.checks.normalFactsPreserved=wordsKept(textEvents().slice(prior),'normal');report.timing.normalTextAfterAudioEndMs=Math.round(textEvents().at(-1).receivedAtMs-row.audio.audioEndedAtMs);});
 await step('automatic_protection',async row=>{const prior=textEvents().length;row.audio=await play(caller,'attack');await until(()=>protections().some(e=>e.enabled&&e.reason==='욕설·위협 표현 감지'),'automatic_shield');await until(()=>textEvents().length>prior,'attack_text');const p=protections().find(e=>e.enabled&&e.reason==='욕설·위협 표현 감지');report.checks.automaticShield=true;report.checks.queuedAudioCleared=officer.events.some(e=>e.event==='clear');report.checks.abuseNotReproduced=textEvents().slice(prior).every(e=>!/새끼|병신|뒈져/.test(e.text));report.timing.abuseAudioStartToShieldMs=p.receivedAtMs-row.audio.startedAtMs;report.timing.abuseAudioEndToTextMs=Math.round(textEvents().at(-1).receivedAtMs-row.audio.audioEndedAtMs);});
 await step('request_while_protected',async row=>{await delay(200);const before=officer.frames,prior=textEvents().length;row.audio=await play(caller,'followup');await until(()=>wordsKept(textEvents().slice(prior),'followup'),'protected_facts');report.checks.callerAudioBlocked=officer.frames===before;report.checks.analysisContinuesWhileProtected=true;report.checks.protectedFactsPreserved=wordsKept(textEvents().slice(prior),'followup');report.timing.protectedTextAfterAudioEndMs=Math.round(textEvents().at(-1).receivedAtMs-row.audio.audioEndedAtMs);});
 await step('officer_voice_while_protected',async row=>{const before=caller.frames;row.audio=await play(officer,'normal');await until(()=>caller.frames>=before+row.audio.framesSent,'officer_voice_frames',15000);report.checks.officerVoiceStillDelivered=true;report.checks.textVisibleOnlyToOfficer=!caller.events.some(e=>e.event==='neutral_text');});
 await step('restore_original_audio',async row=>{officer.send({event:'resume',callId});await until(()=>protections().some(e=>e.enabled===false),'resume');const before=officer.frames,prior=textEvents().length;row.audio=await play(caller,'normal');await until(()=>wordsKept(textEvents().slice(prior),'normal'),'restored_facts');report.checks.resumeRestoresCallerAudio=officer.frames>before;report.checks.normalTextAfterResume=wordsKept(textEvents().slice(prior),'normal');});
 await step('hangup',async()=>{officer.send({event:'hangup',callId});await until(()=>caller.events.some(e=>e.event==='ended')&&officer.events.some(e=>e.event==='ended'&&e.callId===callId),'hangup');await until(()=>officer.events.filter(e=>e.event==='calls').at(-1)?.calls?.some(c=>c.id===callId&&c.status==='ended'&&!c.finalizing),'finalized');report.checks.cleanHangup=true;report.checks.noAnalysisErrors=!report.errors.length;});
 report.passed=Object.values(report.checks).every(Boolean);
}catch(e){report.passed=false;report.error=e.message;}
finally{report.finishedAt=new Date().toISOString();report.elapsedMs=elapsed();report.texts=officer?textEvents().map(e=>({text:e.text,facts:e.facts,status:e.status,receivedAtMs:e.receivedAtMs})):[];report.protectionEvents=officer?protections():[];report.receivedFrames={officer:officer?.frames||0,caller:caller?.frames||0};if(callId&&officer?.ws.readyState===Ws.OPEN)officer.send({event:'hangup',callId});for(const s of sockets)s.terminate();await save();console.log(JSON.stringify({passed:report.passed,checks:report.checks,timing:report.timing,error:report.error,resultPath:destination}));}
if(!report.passed)process.exitCode=1;
