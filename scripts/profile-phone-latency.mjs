// Local diagnostic only. Production bridge/websites are never changed.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {CallAnalysis} from '../phone/analysis.mjs';
import {telephoneAudio} from '../phone/audio.mjs';
const mode=process.argv.find(v=>v.startsWith('--mode='))?.split('=')[1]||'baseline';
const sampleName=process.argv.find(v=>v.startsWith('--sample='))?.split('=')[1]||'attack';
if(!process.argv.includes('--live')||!['baseline','partial-low','partial-minimal'].includes(mode))throw Error('Use --live --mode=baseline|partial-low|partial-minimal');
const key=process.env.SERVICE_OPENAI_API_KEY||process.env.OPENAI_API_KEY;if(!key)throw Error('Existing OpenAI key missing');
const folder=resolve('../phone-licensed-check'),manifest=JSON.parse((await readFile(resolve(folder,'samples.json'),'utf8')).replace(/^\uFEFF/,''));
const model=process.env.SERVICE_OPENAI_MODEL||'gpt-6-luna',traces=[],start=performance.now(),ms=()=>Math.round(performance.now()-start);
let audioStartedAt,shieldAt,finalText,activeSafety=0,maxActiveSafety=0,analysis;
const record=(type,details={})=>traces.push({atMs:ms(),type,...details});
analysis=new CallAnalysis({key,model,onText:e=>{finalText=e;record('neutral_text',e);},onShield:(decision,text)=>{shieldAt??=ms();record('shield',{decision,text});},onError:message=>record('analysis_error',{message}),onProcessing:turnId=>record('processing',{turnId})});
const p=analysis.pipeline;
for(const method of ['checkSafety','verifyAudio','neutralize']){const original=p[method].bind(p);p[method]=async(...args)=>{const started=ms();if(method==='checkSafety')maxActiveSafety=Math.max(maxActiveSafety,++activeSafety);record(method+'_start',method==='checkSafety'?{transcript:args[0]}:{});try{const result=await original(...args);record(method+'_end',{elapsedMs:ms()-started,result});return result;}catch(e){record(method+'_error',{message:e.message});throw e;}finally{if(method==='checkSafety')activeSafety--;}};}
const onStart=analysis.segmenter.onStart,onEnd=analysis.segmenter.onEnd;
analysis.segmenter.onStart=()=>{record('speech_start');onStart();};analysis.segmenter.onEnd=(...args)=>{record('speech_end',{audioSeconds:args[0].length/8000});onEnd(...args);};
let lastClassified='',lastStarted=-Infinity,timer,busy=false,queued=null;
async function classifyPartial(){
 if(busy||!queued||analysis.ended)return;
 const turn=queued;queued=null;const text=turn.partial;if(text.trim().length<8||text===lastClassified||turn.shielded)return;lastClassified=text;lastStarted=ms();busy=true;
 try{const r=await p.checkSafety(text);turn.reported=r.scope==='reported_speech';if(!analysis.ended&&r.directAbuse&&!turn.shielded){turn.shielded=true;analysis.onShield(r,text);}}
 catch(e){record('partial_candidate_error',{message:e.message});}
 finally{busy=false;if(queued&&!analysis.ended){clearTimeout(timer);timer=setTimeout(()=>void classifyPartial(),Math.max(0,1200-(ms()-lastStarted)));}}
}
if(mode!=='baseline'){
 // Prototype: rate-limit all new partial text, without a profanity-word gate.
 // Model, contextual evidence checks, and final fact extraction stay the same.
 const schedule=turn=>{if(turn.shielded||turn.partial.trim().length<8)return;queued=turn;clearTimeout(timer);timer=setTimeout(()=>void classifyPartial(),Math.max(0,1200-(ms()-lastStarted)));};
 analysis.guard=async turn=>schedule(turn);
 // The live transcriber session setting is changed below on the outbound update.
 const originalStart=analysis.start.bind(analysis);
 analysis.start=async()=>{const running=originalStart();const send=analysis.socket.send.bind(analysis.socket);analysis.socket.send=(data,...rest)=>{const event=JSON.parse(data);if(event.type==='session.update')event.session.audio.input.transcription.delay=mode==='partial-minimal'?'minimal':'low';return send(JSON.stringify(event),...rest);};await running;};
}
const result={mode,startedAt:new Date().toISOString(),model,source:manifest.samples.find(s=>s.name===sampleName),syntheticAudio:true,productionChanged:false,policy:mode==='baseline'?'unchanged production class':'prototype: delay='+(mode==='partial-minimal'?'minimal':'low')+'; classify new partials every >=1200ms; minimum partial length 8; one in-flight partial request; no lexical scheduling gate',traces};
if(!result.source)throw Error('Unknown licensed sample');
let failure;
try{
 await analysis.start();record('session_ready');
 analysis.socket.on('message',bytes=>{const e=JSON.parse(bytes);if(e.type.includes('transcription')||e.type==='input_audio_buffer.committed')record('stt_event',{event:e.type,itemId:e.item_id,delta:e.delta,transcript:e.transcript});
  if(mode!=='baseline'&&e.type==='conversation.item.input_audio_transcription.delta'){const turn=analysis.items.get(e.item_id)||analysis.pending[0]||analysis.turn;if(turn&&turn.partial.trim().length>=8){queued=turn;clearTimeout(timer);timer=setTimeout(()=>void classifyPartial(),Math.max(0,1200-(ms()-lastStarted)));}}
 });
 const audio=telephoneAudio(await readFile(resolve(folder,result.source.path)));audioStartedAt=ms();record('audio_start');const at=performance.now();
 for(let pos=0;pos<audio.length+12000;pos+=160){await delay(Math.max(0,at+pos/8-performance.now()));const frame=Buffer.alloc(160,255);if(pos<audio.length)audio.copy(frame,0,pos,Math.min(pos+160,audio.length));analysis.push(frame);}
 record('audio_sent');const deadline=performance.now()+45000;while(!finalText&&performance.now()<deadline)await delay(50);if(!finalText)throw Error('Text timeout');await analysis.stop();
}catch(e){failure=e.message;record('failure',{message:failure});}
finally{clearTimeout(timer);await analysis.stop().catch(()=>{});analysis.socket?.terminate();const drainDeadline=performance.now()+22000;while(busy&&performance.now()<drainDeadline)await delay(20);result.partialPendingOnClose=busy;result.finishedAt=new Date().toISOString();result.error=failure;result.shieldFromAudioStartMs=shieldAt?shieldAt-audioStartedAt:null;result.firstDeltaFromAudioStartMs=(traces.find(e=>e.type==='stt_event'&&e.event.endsWith('.delta'))?.atMs??NaN)-audioStartedAt;result.maxConcurrentSafetyCalls=maxActiveSafety;result.usage=p.usage;result.finalText=finalText;await mkdir(folder,{recursive:true});const file=resolve(folder,'profile-'+mode+'-'+sampleName+'-'+Date.now()+'.json');await writeFile(file,JSON.stringify(result,null,2));console.log(JSON.stringify({mode,sampleName,shieldFromAudioStartMs:result.shieldFromAudioStartMs,firstDeltaFromAudioStartMs:result.firstDeltaFromAudioStartMs,usageCalls:p.usage.length,error:failure,file}));}
if(failure)process.exitCode=1;
