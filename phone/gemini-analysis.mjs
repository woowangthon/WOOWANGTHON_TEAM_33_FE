import {randomUUID} from 'node:crypto';
import {GeminiTranscriber} from './gemini-transcriber.mjs';
import {GeminiPipeline,groundedTarget} from './gemini-pipeline.mjs';
import {TargetPipeline} from './target-policy.mjs';
import {LiveSafety} from './live-safety.mjs';
import {pcm16k} from './clova-stream.mjs';
import {reviewConversation} from './conversation.mjs';
export class GeminiCallAnalysis {
  constructor({geminiKey,key,textProvider='gemini',onText,onShield,onError,onTranscript=()=>{},onTyping=()=>{},onProcessing=()=>{},onSettled=()=>{},onAudioBoundary=()=>{},onAudioReviewed=()=>{},model,transcriptionModel='gemini-3.5-transcribe-live',safetyIntervalMs=400,pipeline,transcriberFactory=options=>new GeminiTranscriber(options)}){
    if(!['openai','gemini'].includes(textProvider)||(!pipeline&&(textProvider==='openai'?!key:!geminiKey)))throw Error('Phone_text_configuration_missing');
    Object.assign(this,{onText,onShield,onError,onTranscript,onTyping,onProcessing,onSettled,onAudioBoundary,onAudioReviewed});this.pipeline=pipeline||(textProvider==='openai'?new TargetPipeline({apiKey:key,model:model||'gpt-6-luna'}):new GeminiPipeline({apiKey:geminiKey,model:model||'gemini-3.5-flash-lite'}));
    this.history=[];this.jobs=new Set();this.turn=null;this.ready=false;this.ended=false;this.stopping=false;this.healthy=true;
    this.guard=new LiveSafety({intervalMs:safetyIntervalMs,check:(text,options)=>this.pipeline.checkSafety(text,options),onResult:(turn,result)=>{this.healthy=true;this.protect(turn,result);},onError:error=>this.error(/insufficient_quota/.test(error?.message||'')?'OpenAI 크레딧을 확인해 주세요. 수신 음성을 보호하고 있습니다.':error?.status===429||error?.message==='Gemini_HTTP_429'?'AI 요청 한도에 도달해 수신 음성을 보호하고 있습니다.':'음성 보호 판정을 확인하지 못했습니다.')});
    this.turns=new Set();
    this.transcriber=transcriberFactory({apiKey:geminiKey,model:transcriptionModel,onInterim:text=>this.interim(text),onFinal:(text,range)=>this.final(text,range),onError:()=>this.error('음성 인식 연결을 확인해 주세요.')});
  }
  makeTurn(){const turn={id:randomUUID(),at:new Date().toISOString(),prefix:this.history.slice(-3).join('\n'),currentText:'',partial:'',shielded:false,finalReview:false};this.turns.add(turn);return turn;}
  update(turn,text){turn.currentText=text;turn.partial=(turn.prefix?turn.prefix+'\n':'')+text;}
  async start(){await this.transcriber.start();if(this.ended){this.transcriber.close();return;}this.ready=true;}
  push(frame){if(this.ready&&!this.ended&&!this.stopping)this.pushPcm(pcm16k(frame));}
  pushPcm(frame){if(this.ready&&!this.ended&&!this.stopping)this.transcriber.push(frame);}
  interim(text){if(this.ended||this.stopping)return;this.turn??=this.makeTurn();this.update(this.turn,text);this.onTyping(true);this.guard.enqueue(this.turn);}
  protect(turn,result){
    if(this.ended||this.stopping||turn.shielded||!groundedTarget(result,turn.partial,turn.currentText))return;
    turn.shielded=true;this.onShield(result,turn.partial);
  }
  canResume(){return this.ready&&this.healthy&&!this.ended&&!this.stopping;}
  error(message){if(!this.ended){this.healthy=false;this.onError(message);}}
  final(text,range){
    if(this.ended)return;const turn=this.turn||this.makeTurn();this.turn=null;this.onTyping(false);this.update(turn,text);this.guard.finish(turn);
    this.history.push(text);if(this.history.length>3)this.history.shift();
    if(!this.stopping)this.onAudioBoundary(turn.id,range);
    if(this.jobs.size>=3){this.error('일부 음성 내용을 다시 확인해야 합니다.');this.turns.delete(turn);return;}
    this.onProcessing(turn.id);
    const job=this.review(turn).catch(()=>this.error('일부 음성 내용을 정리하지 못했습니다.')).finally(()=>{this.onSettled(turn.id);this.turns.delete(turn);this.jobs.delete(job);});this.jobs.add(job);
  }
  async review(turn){
    const [summary,safety]=await Promise.allSettled([
      this.pipeline.structured?reviewConversation(this.pipeline,turn.currentText):this.pipeline.neutralize(turn.currentText),
      this.pipeline.checkSafety(turn.partial,{currentText:turn.currentText}).then(result=>{
        this.healthy=true;this.protect(turn,result);
        if(!this.ended&&!this.stopping)this.onAudioReviewed(turn.id,!turn.shielded&&!result.directAbuse&&['normal','criticism','reported_speech'].includes(result.scope));
      }),
    ]);
    if(safety.status==='rejected')this.error('음성 보호 판정을 확인하지 못했습니다.');
    if(summary.status==='rejected')throw summary.reason;
    if(!this.ended)this.onTranscript({turnId:turn.id,at:turn.at,text:summary.value.displayText||summary.value.text||'[공격 표현 가림]',redacted:summary.value.redacted===true});
    if(!this.ended&&summary.value.facts.length)this.onText({turnId:turn.id,revision:1,text:summary.value.text,facts:summary.value.facts.map(({kind,value})=>({kind,value})),status:'transcribed'});
  }
  async stop(){
    if(this.ended||this.stopping)return;this.stopping=true;this.ready=false;this.guard.close();
    try{await this.transcriber.finish();}catch{this.error('통화 마지막 발화를 확인해야 합니다.');}finally{this.transcriber.close();}
    let timer;try{await Promise.race([Promise.allSettled([...this.jobs]),new Promise(resolve=>{timer=setTimeout(resolve,20000);})]);}finally{clearTimeout(timer);}
    if(this.jobs.size)this.error('일부 음성 정리 시간이 초과되었습니다.');this.ended=true;this.turns.clear();
  }
}
