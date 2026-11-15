// Billable local comparison only. Does not change production, call people, or write complaints.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import {CallAnalysis} from '../phone/analysis.mjs';
import {telephoneAudio} from '../phone/audio.mjs';
import {ClovaStream,ClovaRecheck,ClovaFile,clovaInvokeUrl} from '../phone/clova-stream.mjs';
import {GeminiPipeline} from '../phone/gemini-pipeline.mjs';
import {LiveSafety} from '../phone/live-safety.mjs';
import {GeminiLiveSafety} from '../phone/gemini-live.mjs';

export function comparisonConfiguration(env=process.env,{textOnly=false,baseline=false,nativeLive=false}={}){
  const recheckMode=env.PHONE_CLOVA_RECHECK_MODE||'stream';
  if(!['stream','upload'].includes(recheckMode))throw Error('Invalid_CLOVA_recheck_mode');
  const required=['GEMINI_API_KEY',...(!textOnly&&!nativeLive?['CLOVA_STREAM_SECRET_KEY',...(recheckMode==='upload'?['CLOVA_SPEECH_SECRET_KEY','CLOVA_SPEECH_INVOKE_URL']:[])]:[])];
  if(baseline&&!env.SERVICE_OPENAI_API_KEY&&!env.OPENAI_API_KEY)required.push('OPENAI_API_KEY');
  const missing=required.filter(name=>!env[name]?.trim());
  if(!missing.length&&!textOnly&&!nativeLive&&recheckMode==='upload')clovaInvokeUrl(env.CLOVA_SPEECH_INVOKE_URL);
  return {ready:missing.length===0,missing,model:nativeLive?(env.PHONE_GEMINI_LIVE_MODEL||'gemini-3.8-live'):(env.PHONE_GEMINI_MODEL||'gemini-3.5-flash-lite'),thinkingLevel:nativeLive?null:(env.PHONE_GEMINI_THINKING_LEVEL||'minimal'),stt:nativeLive?'Gemini Live native audio':textOnly?null:'CLOVA Speech gRPC',recheckMode,productionChanged:false};
}
async function runGeminiLive(audio,config){
  const started=performance.now(),elapsed=()=>Math.round(performance.now()-started),events=[],decisions=[];
  let audioAt,firstTranscriptAt=null,shieldAt=null;
  const live=new GeminiLiveSafety({apiKey:process.env.GEMINI_API_KEY,model:config.model,
    onTranscript:()=>{firstTranscriptAt??=elapsed();},onEvent:e=>events.push({atMs:elapsed(),...e}),
    onDecision:(result,text)=>{if(result.directAbuse)shieldAt??=elapsed();decisions.push({atMs:elapsed(),result,text});}});
  try{
    await live.start();audioAt=elapsed();const at=performance.now(),total=Math.ceil(audio.length/160)*160+6400;
    for(let pos=0;pos<total;pos+=160){await delay(Math.max(0,at+pos/8-performance.now()));if(live.error)throw live.error;const frame=Buffer.alloc(160,255);if(pos<audio.length)audio.copy(frame,0,pos,Math.min(pos+160,audio.length));live.push(frame);}
    live.endInput();const deadline=performance.now()+15000;
    while(performance.now()<deadline&&!live.error&&(!decisions.length||!live.turns))await delay(20);
    if(live.error)throw live.error;if(!decisions.length)throw Error('Gemini_live_grounded_decision_missing');
    return {provider:'gemini-live',model:config.model,audioDurationMs:audio.length/8,firstTranscriptFromAudioStartMs:firstTranscriptAt===null?null:firstTranscriptAt-audioAt,shieldFromAudioStartMs:shieldAt===null?null:shieldAt-audioAt,transcript:live.transcript,decisions,events};
  }catch(error){error.diagnostics={events,decisions,transcript:live.transcript};throw error;}
  finally{live.close();}
}
async function runOpenAI(audio){
  const started=performance.now(),elapsed=()=>Math.round(performance.now()-started),errors=[],decisions=[];
  let shieldAt=null,finalText,audioAt;
  const analysis=new CallAnalysis({key:process.env.SERVICE_OPENAI_API_KEY||process.env.OPENAI_API_KEY,model:process.env.SERVICE_OPENAI_MODEL||'gpt-6-luna',onText:e=>{finalText=e;},onShield:(r,text)=>{shieldAt??=elapsed();decisions.push({atMs:elapsed(),result:r,text});},onError:e=>errors.push(e),onProcessing:()=>{}});
  try{
    await analysis.start();audioAt=elapsed();const at=performance.now();
    for(let pos=0;pos<audio.length+12000;pos+=160){await delay(Math.max(0,at+pos/8-performance.now()));const frame=Buffer.alloc(160,255);if(pos<audio.length)audio.copy(frame,0,pos,Math.min(pos+160,audio.length));analysis.push(frame);}
    const deadline=performance.now()+60000;while(!finalText&&performance.now()<deadline)await delay(20);
    if(!finalText)throw Error('OpenAI_final_text_timeout');
    return {provider:'openai',shieldFromAudioStartMs:shieldAt===null?null:shieldAt-audioAt,finalText,errors,decisions,usage:analysis.pipeline.usage};
  }finally{await analysis.stop();await analysis.liveSafety.running?.promise;}
}
async function runClovaGemini(audio,config){
  const started=performance.now(),elapsed=()=>Math.round(performance.now()-started),traces=[],errors=[],turn={partial:''};
  let shieldAt=null,audioAt,firstTranscriptAt=null;
  const audioVerifier=config.recheckMode==='upload'?new ClovaFile({secret:process.env.CLOVA_SPEECH_SECRET_KEY,invokeUrl:process.env.CLOVA_SPEECH_INVOKE_URL}):new ClovaRecheck({secret:process.env.CLOVA_STREAM_SECRET_KEY});
  const pipeline=new GeminiPipeline({apiKey:process.env.GEMINI_API_KEY,model:config.model,thinkingLevel:config.thinkingLevel,audioVerifier});
  const protect=(result,text)=>{traces.push({atMs:elapsed(),type:'safety',text,result});if(result.directAbuse&&!turn.shielded){turn.shielded=true;shieldAt=elapsed();}};
  const guard=new LiveSafety({intervalMs:Number(process.env.PHONE_SAFETY_INTERVAL_MS||1200),check:(...args)=>pipeline.checkSafety(...args),onResult:(t,r,text)=>protect(r,text),onError:()=>errors.push('partial_safety_failed')});
  const stream=new ClovaStream({secret:process.env.CLOVA_STREAM_SECRET_KEY,epdMs:Number(process.env.PHONE_CLOVA_EPD_MS||500),onProtocol:e=>traces.push({atMs:elapsed(),type:'protocol',data:e}),onTranscript:e=>{firstTranscriptAt??=elapsed();traces.push({atMs:elapsed(),type:'stt',...e});turn.partial=e.fullText;guard.enqueue(turn);}});
  try{
    await stream.start();audioAt=elapsed();const at=performance.now(),total=Math.ceil(audio.length/160)*160+12000;
    for(let pos=0;pos<total;pos+=160){await delay(Math.max(0,at+pos/8-performance.now()));const frame=Buffer.alloc(160,255);if(pos<audio.length)audio.copy(frame,0,pos,Math.min(pos+160,audio.length));await stream.write(frame,{final:pos+160>=total});}
    const liveTranscript=await stream.finish();
    const transcript=await pipeline.verifyAudio(audio);guard.finish(turn);
    const [result,safety]=await Promise.all([pipeline.neutralize(transcript),pipeline.checkSafety(transcript).then(r=>{protect(r,transcript);return r;})]);
    return {provider:'clova-gemini',model:config.model,firstTranscriptFromAudioStartMs:firstTranscriptAt===null?null:firstTranscriptAt-audioAt,shieldFromAudioStartMs:shieldAt===null?null:shieldAt-audioAt,liveTranscript,verifiedTranscript:transcript,finalSafety:safety,finalText:result,errors,traces,usage:pipeline.usage};
  }catch(error){error.diagnostics={traces,errors,usage:pipeline.usage};throw error;}
  finally{guard.close();stream.stop();await guard.running?.promise;}
}
async function main(){
  const args=process.argv.slice(2),textOnly=args.includes('--text-only'),baseline=args.includes('--baseline'),nativeLive=args.includes('--gemini-live');
  if(textOnly&&nativeLive)throw Error('Invalid_comparison_mode');
  const config=comparisonConfiguration(process.env,{textOnly,baseline,nativeLive});
  if(args.includes('--check-config')){console.log(JSON.stringify(config));if(!config.ready)process.exitCode=2;return;}
  if(!args.includes('--live'))throw Error('Use --check-config or --live; external APIs are billable.');
  if(!config.ready){console.log(JSON.stringify(config));process.exitCode=2;return;}
  const folder=resolve('../phone-licensed-check'),manifest=JSON.parse((await readFile(resolve(folder,'samples.json'),'utf8')).replace(/^\uFEFF/,''));
  if(manifest.commentsSource.license!=='MIT'||manifest.complaintsSource.license!=='이용허락범위 제한 없음'||manifest.sourceTextModified!==false)throw Error('Licensed_source_manifest_required');
  const selected=args.find(arg=>arg.startsWith('--sample='))?.slice(9);
  const samples=manifest.samples.filter(row=>selected?selected.split(',').includes(row.name):['normal','attack','thirdparty'].includes(row.name));
  if(!samples.length)throw Error('Unknown_sample');
  const report={startedAt:new Date().toISOString(),config,syntheticAudio:true,originalCallRecording:false,sourceTextModified:false,productionChanged:false,hardwareTested:false,rows:[]};
  for(const source of samples){
    const row={source};report.rows.push(row);
    try{
      if(textOnly){const p=new GeminiPipeline({apiKey:process.env.GEMINI_API_KEY,model:config.model,thinkingLevel:config.thinkingLevel});row.gemini={safety:await p.checkSafety(source.text),neutral:await p.neutralize(source.text),usage:p.usage};}
      else{
        const wav=await readFile(resolve(folder,source.path));if(createHash('sha256').update(wav).digest('hex')!==source.sha256)throw Error('Source_audio_hash_mismatch');
        const audio=telephoneAudio(wav);if(baseline)row.openai=await runOpenAI(audio);if(nativeLive)row.geminiLive=await runGeminiLive(audio,config);else row.clovaGemini=await runClovaGemini(audio,config);
      }
    }catch(e){row.error=/^(CLOVA_|Gemini_|OpenAI_|Source_|Invalid_|Ungrounded_|Unverified_)/.test(e.message)?e.message:'Provider_comparison_failed';row.diagnostics=e.diagnostics;process.exitCode=1;break;}
  }
  report.finishedAt=new Date().toISOString();await mkdir(folder,{recursive:true});const file=resolve(folder,'provider-comparison-'+Date.now()+'.json');await writeFile(file,JSON.stringify(report,null,2));
  console.log(JSON.stringify({file,productionChanged:false,rows:report.rows.map(row=>({sample:row.source.name,error:row.error,openaiShieldMs:row.openai?.shieldFromAudioStartMs,clovaGeminiShieldMs:row.clovaGemini?.shieldFromAudioStartMs,geminiLiveShieldMs:row.geminiLive?.shieldFromAudioStartMs}))}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
