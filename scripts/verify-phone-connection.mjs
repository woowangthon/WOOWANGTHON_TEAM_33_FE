// Production tickets + WSS + real STT startup. Sends silence, never records the PC microphone.
import {createRequire} from 'node:module';
import {writeFile,mkdir,readFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
const sockets=[],checks={},report={testedAt:new Date().toISOString(),checks,actualMicrophone:false,spokenAudio:false,sttStartup:false};
await mkdir('outputs/phone-runtime',{recursive:true});
try{const previous=await readFile('outputs/phone-runtime/verification-connection.json','utf8');await writeFile('outputs/phone-runtime/verification-connection-'+Date.now()+'.json',previous);}catch(e){if(e.code!=='ENOENT')throw e;}
async function until(check,name){const start=Date.now();while(!check()){if(Date.now()-start>20000)throw Error(name+' timed out');await delay(30);}}
async function connect(origin,role){
 const r=await fetch(origin+'/api/phone',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({demo:true}),signal:AbortSignal.timeout(15000)});
 const settings=await r.json();if(!r.ok||settings.role!==role)throw Error('Website ticket '+r.status);
 const ws=new Ws(settings.url,{origin}),events=[];sockets.push(ws);ws.on('error',()=>{});ws.on('message',b=>events.push(JSON.parse(b)));
 await until(()=>ws.readyState===Ws.OPEN,'WSS');ws.send(JSON.stringify({event:'auth',token:settings.token}));
 return{ws,events,send:e=>ws.send(JSON.stringify(e))};
}
let staff,caller,id;
try{
 const health=await(await fetch('https://shield-solve-staff.vercel.app/api/phone')).json();if(!health.online||health.available)throw Error('Bridge is offline or another officer is already available; avoid interfering');
 staff=await connect('https://shield-solve-staff.vercel.app','staff');await until(()=>staff.events.some(e=>e.event==='ready'),'staff ready');checks.staffTicketAndWss=true;
 caller=await connect('https://shield-and-solve.vercel.app','caller');await until(()=>caller.events.some(e=>e.event==='waiting'),'caller waiting');id=caller.events.find(e=>e.event==='waiting').callId;checks.callerTicketAndWss=true;
 staff.send({event:'accept',callId:id});await until(()=>staff.events.some(e=>e.event==='active'&&e.callId===id)&&caller.events.some(e=>e.event==='active'),'active STT');checks.realSttConnection=true;report.sttStartup=true;
 const payload=Buffer.alloc(160,255).toString('base64');caller.send({event:'media',payload});await until(()=>staff.events.some(e=>e.event==='media'&&e.payload===payload),'caller audio');checks.callerAudioTransport=true;
 staff.send({event:'media',callId:id,payload});await until(()=>caller.events.some(e=>e.event==='media'&&e.media?.payload===payload),'staff audio');checks.staffAudioTransport=true;
 staff.send({event:'shield',callId:id});await until(()=>staff.events.some(e=>e.event==='protection'&&e.enabled),'manual shield');await delay(100);
 const before=staff.events.filter(e=>e.event==='media').length;caller.send({event:'media',payload});await delay(150);checks.shieldBlocksCaller=staff.events.filter(e=>e.event==='media').length===before;
 staff.send({event:'resume',callId:id});await until(()=>staff.events.some(e=>e.event==='protection'&&e.enabled===false),'resume');caller.send({event:'media',payload});await until(()=>staff.events.filter(e=>e.event==='media').length>before,'resumed caller');checks.resumeRestoresAudio=true;
 staff.send({event:'hangup',callId:id});await until(()=>staff.events.some(e=>e.event==='ended'&&e.callId===id)&&caller.events.some(e=>e.event==='ended'),'hangup');checks.cleanHangup=true;
 checks.noAnalysisErrors=!staff.events.some(e=>['error','analysis_error'].includes(e.event));report.passed=Object.values(checks).every(Boolean);
}catch(e){report.passed=false;report.error=e.message;}
finally{if(staff?.ws.readyState===Ws.OPEN&&id)staff.send({event:'hangup',callId:id});for(const s of sockets)s.terminate();await mkdir('outputs/phone-runtime',{recursive:true});await writeFile('outputs/phone-runtime/verification-connection.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
if(!report.passed)process.exitCode=1;
