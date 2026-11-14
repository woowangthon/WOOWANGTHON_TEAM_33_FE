// Experimental provider adapter; not selected by the production bridge.
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {decodeMuLaw,pcmWav} from './audio.mjs';
const definition=protoLoader.loadSync(fileURLToPath(new URL('./clova-nest.proto',import.meta.url)),{keepCase:true,enums:String,defaults:true,oneofs:true});
export const ClovaService=grpc.loadPackageDefinition(definition).com.nbp.cdncp.nest.grpc.proto.v1.NestService;

export function pcm16k(muLaw){
  const pcm=Buffer.alloc(muLaw.length*4);
  for(let i=0;i<muLaw.length;i++){
    const value=decodeMuLaw(muLaw[i]),next=decodeMuLaw(muLaw[Math.min(i+1,muLaw.length-1)]);
    pcm.writeInt16LE(value,i*4);pcm.writeInt16LE(Math.round((value+next)/2),i*4+2);
  }
  return pcm;
}
export function clovaInvokeUrl(value){
  const url=new URL(value);
  if(url.protocol!=='https:'||url.hostname!=='clovaspeech-gw.ncloud.com'||url.username||url.password||url.search||url.hash||!/^\/external\/v1\/\d+\/[a-zA-Z0-9_-]+\/?$/.test(url.pathname))throw Error('Invalid_CLOVA_invoke_URL');
  return url.href.replace(/\/$/,'');
}
export class ClovaFile {
  constructor({secret,invokeUrl,fetcher=fetch}){if(!secret)throw Error('CLOVA_secret_missing');Object.assign(this,{secret,invokeUrl:clovaInvokeUrl(invokeUrl),fetcher});}
  async verifyAudio(muLaw){
    const form=new FormData();form.set('media',new Blob([pcmWav(pcm16k(muLaw),16000)],{type:'audio/wav'}),'turn.wav');
    form.set('params',JSON.stringify({language:'ko-KR',completion:'sync',fullText:true,wordAlignment:false,diarization:{enable:false}}));
    const response=await this.fetcher(this.invokeUrl+'/recognizer/upload',{method:'POST',headers:{'X-CLOVASPEECH-API-KEY':this.secret},body:form,redirect:'error',signal:AbortSignal.timeout(65000)});
    if(!response.ok)throw Error('CLOVA_upload_HTTP_'+response.status);
    const data=await response.json();if(data.result!=='SUCCEEDED'||typeof data.text!=='string'||!data.text.trim())throw Error('CLOVA_upload_not_completed');
    return data.text;
  }
}
export class ClovaStream {
  constructor({secret,onTranscript=()=>{},onProtocol=()=>{},endpoint='clovaspeech-gw.ncloud.com:50051',credentials=grpc.credentials.createSsl(),connectTimeoutMs=12000,resultTimeoutMs=15000,epdMs=500}){
    if(!secret)throw Error('CLOVA_secret_missing');
    if(!Number.isInteger(epdMs)||epdMs<100)throw Error('Invalid_CLOVA_EPD');
    Object.assign(this,{secret,onTranscript,onProtocol,endpoint,credentials,connectTimeoutMs,resultTimeoutMs,epdMs});this.text='';this.closed=false;this.ready=false;this.finalSent=false;
    this.finished=new Promise((resolve,reject)=>{this.resolveFinished=resolve;this.rejectFinished=reject;});this.finished.catch(()=>{});
  }
  async start(){
    this.client=new ClovaService(this.endpoint,this.credentials);
    try{
      await new Promise((resolve,reject)=>this.client.waitForReady(Date.now()+this.connectTimeoutMs,error=>error?reject(Error('CLOVA_connection_failed')):resolve()));
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>this.fail(Error('CLOVA_config_timeout')),this.connectTimeoutMs);
        this.resolveReady=()=>{clearTimeout(timer);this.ready=true;resolve();};
        this.rejectReady=error=>{clearTimeout(timer);reject(error);};
        const metadata=new grpc.Metadata();metadata.set('authorization','Bearer '+this.secret);
        this.call=this.client.recognize(metadata,{deadline:Date.now()+660000});
        this.call.on('data',message=>{try{this.receive(JSON.parse(message.contents));}catch(error){this.fail(error);}});
        this.call.on('error',error=>{if(!this.closed)this.fail(Error('CLOVA_GRPC_'+(Number.isInteger(error.code)?error.code:'error')));});
        this.call.on('end',()=>{if(!this.closed&&!this.finalSeen)this.fail(Error('CLOVA_final_result_missing'));});
        this.call.write({type:'CONFIG',config:{config:JSON.stringify({transcription:{language:'ko'},useDomainForbiddens:false,semanticEpd:{skipEmptyText:false,useWordEpd:true,usePeriodEpd:false,gapThreshold:this.epdMs,durationThreshold:this.epdMs}})}});
      });
    }catch(error){this.stop();throw error;}
  }
  receive(data){
    if(this.closed)return;
    this.onProtocol(data);
    if(data.config){if(data.config.status!=='Success')throw Error('CLOVA_config_rejected');this.resolveReady?.();}
    if(data.recognize?.status&&data.recognize.status!=='Success')throw Error('CLOVA_recognition_rejected');
    const t=data.transcription;if(!t)return;
    if(typeof t.text!=='string'||!Number.isInteger(t.position)||t.position<0||t.position>this.text.length)throw Error('CLOVA_invalid_transcript_position');
    // Positions are absolute offsets: append new spans or replace a revised suffix.
    const next=this.text.slice(0,t.position)+t.text;
    if(next!==this.text){this.text=next;this.onTranscript({text:this.text,...t,fullText:this.text});}
    if(t.epFlag===true&&t.seqId===1&&this.finalSent){this.finalSeen=true;this.resolveFinished(this.text);}
  }
  async write(frame,{final=false}={}){
    if(!this.ready||this.closed||this.finalSent)throw Error('CLOVA_stream_not_writable');
    const chunk=pcm16k(frame);if(!chunk.length)throw Error('CLOVA_empty_audio_chunk');
    if(final)this.finalSent=true;
    const writable=this.call.write({type:'DATA',data:{chunk,extra_contents:JSON.stringify({seqId:final?1:0,epFlag:final})}});
    if(!writable)await once(this.call,'drain',{signal:AbortSignal.timeout(5000)});
    // Keep the request stream open until the endpoint result acknowledges seqId.
    // Half-closing here can terminate recognition before the buffered result arrives.
  }
  async finish(){
    if(!this.finalSent)throw Error('CLOVA_final_frame_required');
    const timer=setTimeout(()=>this.fail(Error('CLOVA_result_timeout')),this.resultTimeoutMs);
    try{const text=await this.finished;if(!text.trim())throw Error('CLOVA_empty_transcript');return text;}
    finally{clearTimeout(timer);this.stop();}
  }
  fail(error){this.rejectReady?.(error);this.rejectFinished(error);this.stop();}
  stop(){if(this.closed)return;this.closed=true;this.ready=false;this.call?.cancel();this.client?.close();}
}

// Independent recognition of completed audio through a fresh gRPC session.
// Uses the official file->stream workflow; this is not the long-form upload API.
export class ClovaRecheck {
  constructor(options){this.options=options;}
  async verifyAudio(muLaw){
    if(!muLaw.length)throw Error('CLOVA_empty_audio_chunk');
    const stream=new ClovaStream(this.options);
    try{
      await stream.start();
      for(let pos=0;pos<muLaw.length;pos+=8000)await stream.write(muLaw.subarray(pos,Math.min(pos+8000,muLaw.length)),{final:pos+8000>=muLaw.length});
      return await stream.finish();
    }finally{stream.stop();}
  }
}
