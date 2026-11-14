import { createRequire } from 'node:module';
import {randomUUID} from 'node:crypto';
import {pcm24k} from './audio.mjs';
import {TextPipeline,transcriptionContext} from './text-pipeline.mjs';
import {LiveSafety} from './live-safety.mjs';
import {reviewNativeAudio} from './native-review.mjs';
import {Segmenter} from './segmenter.mjs';
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
export class CallAnalysis {
  constructor({key,model,onText,onShield,onError,onProcessing,safetyIntervalMs=Number(process.env.PHONE_SAFETY_INTERVAL_MS||1200),nativeReview=reviewNativeAudio}){
    Object.assign(this,{key,onText,onShield,onError,onProcessing});this.pipeline=new TextPipeline({apiKey:key,model});this.jobs=new Set();this.pending=[];this.items=new Map();this.turn=null;this.ready=false;this.ended=false;
    this.nativeReview=nativeReview;
    this.liveSafety=new LiveSafety({intervalMs:safetyIntervalMs,check:(text,options)=>this.pipeline.checkSafety(text,options),onResult:(turn,result,text)=>this.protect(turn,result,text),onError:()=>this.onError('보호 판정을 다시 확인해야 합니다.')});
    this.segmenter=new Segmenter({onStart:()=>{this.turn={id:randomUUID(),partial:'',shielded:false,finalReview:false};},onFrame:frame=>this.socket.send(JSON.stringify({type:'input_audio_buffer.append',audio:pcm24k(frame).toString('base64')})),onEnd:(audio,voiced)=>this.commit(audio,voiced)});
  }
  async start(){
    this.socket=new Ws('wss://api.openai.com/v1/realtime?intent=transcription',{headers:{Authorization:`Bearer ${this.key}`},handshakeTimeout:12000});
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('STT_connection_timeout')),15000);
      this.socket.on('error',()=>{clearTimeout(timeout);reject(new Error('STT_connection_failed'));if(this.ready)this.onError('음성 인식 연결이 끊겼습니다.');});
      this.socket.on('close',()=>{clearTimeout(timeout);reject(new Error('STT_connection_closed'));if(!this.ended&&this.ready)this.onError('음성 인식 연결이 끊겼습니다.');this.ready=false;});
      this.socket.on('open',()=>this.socket.send(JSON.stringify({type:'session.update',session:{type:'transcription',audio:{input:{format:{type:'audio/pcm',rate:24000},transcription:{model:process.env.PHONE_LIVE_TRANSCRIPTION_MODEL||'gpt-live-transcribe',languages:['ko'],delay:'low',prompt:transcriptionContext},turn_detection:null}}}})));
      this.socket.on('message',bytes=>{
        try{
          const e=JSON.parse(bytes.toString());
          if(e.type==='session.updated'){clearTimeout(timeout);if(this.ended){this.socket.terminate();reject(new Error('STT_session_ended'));return;}this.ready=true;resolve();}
          if(e.type==='error'){clearTimeout(timeout);reject(new Error('STT_request_failed'));this.onError('음성 인식 요청을 처리하지 못했습니다.');}
          if(e.type==='input_audio_buffer.committed'){
            const turn=this.pending.shift();if(turn)this.items.set(e.item_id,turn);
          }
          if(e.type==='conversation.item.input_audio_transcription.delta'){
            let turn=this.items.get(e.item_id);
            if(!turn){turn=this.pending[0]||this.turn;if(turn)this.items.set(e.item_id,turn);}
            if(turn&&!this.ended){turn.partial+=e.delta||'';this.guard(turn);}
          }
          if(e.type==='conversation.item.input_audio_transcription.completed')this.items.delete(e.item_id);
          if(e.type==='conversation.item.input_audio_transcription.failed')this.onError('일부 발화를 인식하지 못했습니다. 내용을 확인해 주세요.');
        }catch{this.onError('음성 인식 결과를 처리하지 못했습니다.');}
      });
    }).catch(error=>{this.ended=true;this.socket.terminate();throw error;});
  }
  push(frame){if(this.ready&&!this.ended)this.segmenter.push(frame);}
  guard(turn){if(!this.ended)this.liveSafety.enqueue(turn);}
  protect(turn,result,text){
    if(!this.ended&&!turn.shielded&&result.directAbuse){turn.shielded=true;this.onShield(result,text);}
  }
  commit(audio,voiced){
    const turn=this.turn;this.turn=null;if(!turn)return;
    // Even short buffers are cleared, never accidentally joined to a later speaker turn.
    if(!voiced||audio.length<1600){this.liveSafety.finish(turn);this.socket.send(JSON.stringify({type:'input_audio_buffer.clear'}));return;}
    this.pending.push(turn);this.socket.send(JSON.stringify({type:'input_audio_buffer.commit'}));
    if(this.jobs.size>=3){this.liveSafety.finish(turn);this.onError('분석이 밀리고 있습니다. 잠시 나누어 말씀해 주세요.');return;}
    this.onProcessing(turn.id);
    const job=this.review(turn,audio).catch(()=>this.onError('일부 내용을 정리하지 못했습니다. 담당자가 다시 확인해 주세요.')).finally(()=>{this.liveSafety.finish(turn);this.jobs.delete(job);});this.jobs.add(job);
  }
  async review(turn,audio){
    const transcript=await this.pipeline.verifyAudio(audio);
    this.liveSafety.finish(turn);
    // Final safety and fact extraction start together. Neither waits for a native-audio fallback.
    const [textResult,safetyResult]=await Promise.allSettled([this.pipeline.neutralize(transcript),this.reviewSafety(turn,transcript,audio)]);
    if(textResult.status==='rejected')throw textResult.reason;
    if(safetyResult.status==='rejected')throw safetyResult.reason;
    const checked=safetyResult.value;
    const result=checked.transcript===transcript?textResult.value:await this.pipeline.neutralize(checked.transcript);
    this.onText({turnId:turn.id,revision:1,text:result.text,facts:result.facts.map(({kind,value})=>({kind,value})),status:checked.needsReview?'needs_review':'audio_rechecked'});
  }
  async reviewSafety(turn,transcript,audio){
    try{
      const result=await this.pipeline.checkSafety(transcript);
      this.protect(turn,result,transcript);
      if(result.scope!=='unclear'||turn.shielded)return {transcript,needsReview:false};
    }catch{ /* Uncertain/failed contextual classification gets an original-audio recheck. */ }
    try{
      const result=await this.nativeReview(audio,this.key);
      if(result.uncertain)return {transcript,needsReview:true};
      this.protect(turn,result,result.transcript);
      return {transcript:result.transcript,needsReview:!!result.protectionNeedsReview};
    }catch{return {transcript,needsReview:true};}
  }
  async stop(){
    if(this.ended)return;
    if(this.ready)this.segmenter.flush();this.ended=true;this.liveSafety.close();
    let timeout;
    try{await Promise.race([Promise.allSettled([...this.jobs]),new Promise(resolve=>{timeout=setTimeout(resolve,20000);})]);}finally{clearTimeout(timeout);}
    if(this.jobs.size)this.onError('일부 발화의 분석 시간이 초과되었습니다. 접수 전 내용을 확인해 주세요.');
    this.ready=false;this.socket?.terminate();
  }
}
