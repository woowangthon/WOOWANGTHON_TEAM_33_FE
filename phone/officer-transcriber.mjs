import {randomUUID} from 'node:crypto';
import {GeminiTranscriber} from './gemini-transcriber.mjs';
import {GeminiPipeline} from './gemini-pipeline.mjs';
import {reviewConversation} from './conversation.mjs';
import {pcm16k} from './clova-stream.mjs';

export class OfficerTranscriber {
  constructor({geminiKey,model,transcriptionModel,onTranscript,onTyping=()=>{},onError=()=>{}}){
    this.jobs=new Set();this.closed=false;this.onError=onError;this.onTyping=onTyping;
    this.pipeline=new GeminiPipeline({apiKey:geminiKey,model});
    this.transcriber=new GeminiTranscriber({apiKey:geminiKey,model:transcriptionModel,onInterim:()=>onTyping(true),onFinal:text=>{
      const turnId=randomUUID(),at=new Date().toISOString();onTyping(false);
      if(this.jobs.size>=3){onError('담당자 발화 기록이 지연되고 있습니다.');return;}
      const job=reviewConversation(this.pipeline,text).then(result=>{if(!this.closed)onTranscript({turnId,at,text:result.displayText,redacted:result.redacted});}).catch(()=>onError('담당자 발화를 문자로 확인하지 못했습니다.')).finally(()=>this.jobs.delete(job));this.jobs.add(job);
    },onError:()=>onError('담당자 음성 인식 연결을 확인해 주세요.')});
  }
  start(){return this.transcriber.start();}
  push(frame,pcm){this.transcriber.push(pcm||pcm16k(frame));}
  async stop(){try{await this.transcriber.finish();await Promise.allSettled([...this.jobs]);}finally{this.closed=true;this.transcriber.close();}}
}
