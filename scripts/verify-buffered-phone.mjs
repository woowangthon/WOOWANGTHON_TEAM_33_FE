// Real local WSS -> real Gemini -> delayed officer media. Never touches production or complaint DB.
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createPhoneServer} from '../phone/server.mjs';
import {GeminiCallAnalysis} from '../phone/gemini-analysis.mjs';
import {GeminiTranscriber} from '../phone/gemini-transcriber.mjs';
import {resamplePcm16Wav,pcmWav} from '../phone/audio.mjs';
import {pcm16k} from '../phone/clova-stream.mjs';
import {signTicket} from '../phone/token.mjs';
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
if(!process.argv.includes('--live'))throw Error('Use --live for billable API verification');
if(!process.env.GEMINI_API_KEY)throw Error('Gemini_key_missing');
const folder=resolve('../phone-licensed-check'),manifest=JSON.parse((await readFile(resolve(folder,'samples.json'),'utf8')).replace(/^\uFEFF/,''));
if(!manifest.syntheticAudio||manifest.sourceTextModified!==false||manifest.commentsSource.license!=='MIT'||manifest.complaintsSource.license!=='이용허락범위 제한 없음')throw Error('Licensed_source_required');
const textProvider=process.env.PHONE_TEXT_PROVIDER||'gemini';
const report={startedAt:new Date().toISOString(),productionChanged:false,hardwareTested:false,syntheticAudio:true,textProvider,playbackDelayMs:2500,rows:[]},sockets=[];
let row,audioStarted;
const app=createPhoneServer({secret:'local-verification-only',analysisProvider:'gemini',key:process.env.SERVICE_OPENAI_API_KEY||process.env.OPENAI_API_KEY,geminiKey:process.env.GEMINI_API_KEY,origins:['https://test.local'],playbackDelayMs:report.playbackDelayMs,
 analysisFactory:options=>new GeminiCallAnalysis({...options,textProvider,model:textProvider==='openai'?(process.env.SERVICE_OPENAI_MODEL||'gpt-6-luna'):(process.env.PHONE_GEMINI_MODEL||'gemini-3.5-flash-lite'),geminiKey:process.env.GEMINI_API_KEY,
   transcriberFactory:settings=>new GeminiTranscriber({...settings,onInterim:text=>{if(row){row.firstInterimMs??=Math.round(performance.now()-audioStarted);row.interims.push(text);}settings.onInterim(text);},onFinal:text=>{row?.finals.push(text);settings.onFinal(text);}}),
 })});
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const address='ws://127.0.0.1:'+app.server.address().port+'/connect';
async function until(fn,label,timeout=15000){const at=performance.now();while(!fn()){if(performance.now()-at>timeout)throw Error(label+'_timeout');await delay(10);}}
async function connect(role){const ws=new Ws(address,{origin:'https://test.local'}),events=[],media=[];sockets.push(ws);ws.on('error',()=>{});ws.on('message',b=>{const e=JSON.parse(b.toString());if(e.event==='media')media.push({at:performance.now(),payload:e.payload||e.media?.payload});else{events.push({at:performance.now(),...e});if(row&&e.event==='analysis_error')row.errors.push(e.message);}});await until(()=>ws.readyState===1,'socket');ws.send(JSON.stringify({event:'auth',token:signTicket('local-verification-only',{role})}));return {ws,events,media,send:e=>ws.send(JSON.stringify(e))};}
async function play(peer,pcm,callId){const at=performance.now();for(let pos=0;pos<pcm.length+32000;pos+=640){await delay(Math.max(0,at+pos/32-performance.now()));const frame=Buffer.alloc(640);if(pos<pcm.length)pcm.copy(frame,0,pos,Math.min(pos+640,pcm.length));peer.send({event:'media',callId,format:'pcm16-16000',payload:frame.toString('base64')});}}
const selected=process.argv.find(x=>x.startsWith('--sample='))?.slice(9)?.split(',')||['normal','attack','thirdparty'];
try{
 const officer=await connect('staff');await until(()=>officer.events.some(e=>e.event==='ready'),'officer');
 for(const source of manifest.samples.filter(s=>selected.includes(s.name))){
  row={sample:source.name,sourceId:source.sourceId,interims:[],finals:[],errors:[],checks:{}};report.rows.push(row);
  const wave=await readFile(resolve(folder,source.path));if(createHash('sha256').update(wave).digest('hex')!==source.sha256)throw Error('Source_audio_hash_mismatch');
  const pcm=resamplePcm16Wav(wave),before=officer.media.length,eventBefore=officer.events.length,caller=await connect('caller');await until(()=>caller.events.some(e=>e.event==='waiting'),'waiting');
  const callId=caller.events.find(e=>e.event==='waiting').callId;officer.send({event:'accept',callId});await until(()=>caller.events.some(e=>e.event==='active'),'active');audioStarted=performance.now();
  await play(caller,pcm,callId);await delay(3000);
  const call=app.calls.get(callId);await until(()=>!call.analysis.jobs.size&&!call.analysis.guard.running,'analysis',25000);
  const events=officer.events.slice(eventBefore),shield=events.find(e=>e.event==='protection'&&e.enabled&&e.reason==='욕설·위협 표현 감지');
  row.shieldMs=shield?Math.round(shield.at-audioStarted):null;row.heardFrames=officer.media.length-before;
  row.checks.correctProtection=source.name==='attack'?!!shield:!events.some(e=>e.event==='protection'&&e.enabled);
  row.checks.noAnalysisErrors=row.errors.length===0;
  row.checks.noFramesAfterShield=!shield||officer.media.slice(before).every(e=>e.at<=shield.at);
  row.checks.factsPreserved=source.required.every(word=>call.segments.some(s=>s.text.includes(word)));
  row.texts=call.segments;
  const heard=officer.media.slice(before).map(e=>Buffer.from(e.payload,'base64'));
  await writeFile(resolve(folder,'buffered-heard-'+source.name+'.wav'),pcmWav(pcm16k(Buffer.concat(heard)),16000));
  if(shield){const prior=caller.media.length;officer.send({event:'media',callId,format:'pcm16-16000',payload:Buffer.alloc(640,3).toString('base64')});await until(()=>caller.media.length>prior,'officer_voice');row.checks.officerStillAudible=true;}
  officer.send({event:'hangup',callId});await until(()=>call.finalized,'finalized',30000);row.passed=Object.values(row.checks).every(Boolean);if(!row.passed)break;
 }
}catch(e){report.error=/^[a-zA-Z0-9_]+$/.test(e.message)?e.message:'Verification_failed';}
finally{for(const socket of sockets)socket.terminate();await app.close();report.finishedAt=new Date().toISOString();report.passed=!report.error&&report.rows.length>0&&report.rows.every(r=>r.passed);const file=resolve(folder,'buffered-phone-'+Date.now()+'.json');await writeFile(file,JSON.stringify(report,null,2));console.log(JSON.stringify({file,passed:report.passed,error:report.error,rows:report.rows.map(r=>({sample:r.sample,passed:r.passed,firstInterimMs:r.firstInterimMs,shieldMs:r.shieldMs,checks:r.checks,errors:r.errors}))}));if(!report.passed)process.exitCode=1;}
