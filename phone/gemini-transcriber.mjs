import {createRequire} from 'node:module';
import {setTimeout as delay} from 'node:timers/promises';
const Ws=createRequire(import.meta.url)('next/dist/compiled/ws');
export class GeminiTranscriber {
  constructor({apiKey,model='gemini-3.5-transcribe-live',onInterim=()=>{},onFinal=()=>{},onError=()=>{},socketFactory=url=>new Ws(url,{handshakeTimeout:12000}),connectTimeoutMs=15000,finishTimeoutMs=3000,settleMinMs=1000}){
    if(!apiKey||!/^[a-zA-Z0-9._-]+$/.test(model))throw Error('Gemini_transcription_configuration_missing');
    Object.assign(this,{apiKey,model,onInterim,onFinal,onError,socketFactory,connectTimeoutMs,finishTimeoutMs,settleMinMs});
    this.ready=false;this.closed=false;this.ending=false;this.buffer=Buffer.alloc(0);this.partial='';this.lastTranscriptAt=0;
  }
  async start(){
    this.socket=this.socketFactory('wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key='+encodeURIComponent(this.apiKey));
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.fail('Gemini_transcription_setup_timeout'),this.connectTimeoutMs);
      this.resolveReady=()=>{clearTimeout(timer);this.ready=true;resolve();};this.rejectReady=e=>{clearTimeout(timer);reject(e);};
      this.socket.on('open',()=>this.send({setup:{model:'models/'+this.model,generationConfig:{responseModalities:['TEXT']},inputAudioTranscription:{languageCodes:['ko-KR'],mode:'VERBATIM'},realtimeInputConfig:{interimTranscriptTimestampEnabled:true}}}));
      this.socket.on('message',bytes=>{try{this.receive(JSON.parse(bytes.toString()));}catch{this.fail('Gemini_transcription_invalid_response');}});
      this.socket.on('error',()=>this.fail('Gemini_transcription_connection_failed'));
      this.socket.on('close',(code,reason)=>{if(this.closed)return;const text=reason.toString(),kind=/quota|resource.exhausted/i.test(text)?'quota':/not.found|not.support|model/i.test(text)?'model_access':'closed';this.fail('Gemini_transcription_'+kind+'_'+code);});
    });
  }
  send(message){if(this.closed||this.socket?.readyState!==1)throw Error('Gemini_transcription_not_ready');this.socket.send(JSON.stringify(message));}
  receive(message){
    if(this.closed)return;
    if(message.error){this.fail('Gemini_transcription_API_'+(Number(message.error.code)||0));return;}
    if(message.goAway){this.fail('Gemini_transcription_session_ending');return;}
    if(message.setupComplete)this.resolveReady?.();
    const c=message.serverContent;if(!c)return;
    if(typeof c.interimInputTranscription?.text==='string'){
      this.lastTranscriptAt=performance.now();this.partial=c.interimInputTranscription.text;this.onInterim(this.partial,transcriptRange(c.interimInputTranscription));
    }
    if(typeof c.inputTranscription?.text==='string'){
      this.lastTranscriptAt=performance.now();this.partial='';if(c.inputTranscription.text.trim())this.onFinal(c.inputTranscription.text,transcriptRange(c.inputTranscription));
    }
  }
  push(pcm){
    if(!this.ready||this.closed||this.ending)return;
    if(!Buffer.isBuffer(pcm)||!pcm.length||pcm.length%2)throw Error('Invalid_PCM16_audio');
    this.buffer=Buffer.concat([this.buffer,pcm]);
    while(this.buffer.length>=3200){this.audio(this.buffer.subarray(0,3200));this.buffer=this.buffer.subarray(3200);}
  }
  audio(pcm){if(this.socket.bufferedAmount>128000){this.fail('Gemini_transcription_audio_backlog');return;}this.send({realtimeInput:{audio:{data:pcm.toString('base64'),mimeType:'audio/pcm;rate=16000'}}});}
  async finish(){
    if(this.closed){if(this.error)throw this.error;return;}
    this.ending=true;
    if(this.buffer.length){this.audio(this.buffer);this.buffer=Buffer.alloc(0);}
    this.send({realtimeInput:{audioStreamEnd:true}});
    // Transcription-only sessions do not guarantee an agent turnComplete event.
    // Keep final results, but never promote an unfinished hypothesis to final text.
    const started=performance.now();
    while(!this.closed&&performance.now()-started<this.finishTimeoutMs){await delay(25);if(performance.now()-started>=this.settleMinMs&&!this.partial&&performance.now()-this.lastTranscriptAt>=500)break;}
    if(this.error)throw this.error;
    if(this.partial.trim())throw Error('Gemini_transcription_unfinished_audio');
  }
  fail(code){if(this.closed)return;this.error=Error(code);this.rejectReady?.(this.error);this.onError(code);this.close();}
  close(){if(this.closed)return;this.closed=true;this.ready=false;this.buffer=Buffer.alloc(0);this.rejectReady?.(Error('Gemini_transcription_closed'));this.socket?.terminate();}
}

export function transcriptRange(value){
  const duration=text=>typeof text==='string'&&/^\d+(\.\d{1,9})?s$/.test(text)?Math.round(parseFloat(text)*1000):null;
  const startMs=duration(value.startOffset),endMs=duration(value.endOffset);
  return startMs!==null&&endMs!==null&&endMs>=startMs?{startMs,endMs}:null;
}
