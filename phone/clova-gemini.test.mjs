import test from 'node:test';
import assert from 'node:assert/strict';
import grpc from '@grpc/grpc-js';
import {ClovaService,ClovaStream,ClovaRecheck,ClovaFile,pcm16k,clovaInvokeUrl} from './clova-stream.mjs';
import {GeminiPipeline} from './gemini-pipeline.mjs';
import {comparisonConfiguration} from '../scripts/compare-phone-providers.mjs';
import {encodeMuLaw,decodeMuLaw,readWav} from './audio.mjs';
const normal={directAbuse:false,scope:'normal',category:'none',evidence:''};
const completed=value=>new Response(JSON.stringify({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(value)}]}],usage:{total_tokens:15}}));
async function localServer(t,handler){
 const server=new grpc.Server();server.addService(ClovaService.service,{recognize:handler});
 const port=await new Promise((resolve,reject)=>server.bindAsync('127.0.0.1:0',grpc.ServerCredentials.createInsecure(),(e,p)=>e?reject(e):resolve(p)));
 t.after(()=>server.forceShutdown());return '127.0.0.1:'+port;
}
test('CLOVA conversion is mono 16 kHz PCM16 with interpolated samples',()=>{
 const frame=Buffer.from([encodeMuLaw(1000),encodeMuLaw(-1000)]),pcm=pcm16k(frame);
 assert.equal(pcm.length,8);assert.equal(pcm.readInt16LE(0),decodeMuLaw(frame[0]));
 assert.equal(pcm.readInt16LE(2),0);assert.equal(pcm.readInt16LE(4),decodeMuLaw(frame[1]));
});
test('CLOVA rejects foreign invoke hosts, credentials, redirects and unexpected paths',()=>{
 for(const url of ['http://clovaspeech-gw.ncloud.com/external/v1/1/key','https://evil.example/external/v1/1/key','https://user:pw@clovaspeech-gw.ncloud.com/external/v1/1/key','https://clovaspeech-gw.ncloud.com/external/v1/1/key?token=secret'])assert.throws(()=>clovaInvokeUrl(url));
 assert.equal(clovaInvokeUrl('https://clovaspeech-gw.ncloud.com/external/v1/1/key/'),'https://clovaspeech-gw.ncloud.com/external/v1/1/key');
});
test('real local gRPC verifies config/auth, PCM format, positions and final sequence',async t=>{
 const seen=[];const endpoint=await localServer(t,call=>{
   assert.equal(call.metadata.get('authorization')[0],'Bearer not-a-real-secret');
   call.on('data',message=>{
     seen.push(message);
     if(message.type==='CONFIG'){const cfg=JSON.parse(message.config.config);assert.equal(cfg.transcription.language,'ko');assert.equal(cfg.useDomainForbiddens,false);assert.equal(cfg.semanticEpd.durationThreshold,500);call.write({contents:JSON.stringify({config:{status:'Success'}})});}
     else{assert.equal(message.data.chunk.length,640);const meta=JSON.parse(message.data.extra_contents);call.write({contents:JSON.stringify({transcription:{text:meta.epFlag?' 점검':'가로등',position:meta.epFlag?3:0,epFlag:meta.epFlag,seqId:meta.seqId}})});}
   });call.on('end',()=>call.end());
 });
 const events=[],stream=new ClovaStream({secret:'not-a-real-secret',endpoint,credentials:grpc.credentials.createInsecure(),onTranscript:e=>events.push(e)});t.after(()=>stream.stop());
 await stream.start();await stream.write(Buffer.alloc(160,255));await stream.write(Buffer.alloc(160,255),{final:true});
 assert.equal(await stream.finish(),'가로등 점검');assert.equal(events.at(-1).fullText,'가로등 점검');assert.equal(seen[0].type,'CONFIG');assert.equal(stream.closed,true);
});
test('CLOVA configuration failure is explicit and cannot be reported as a ready stream',async t=>{
 const endpoint=await localServer(t,call=>{call.on('data',()=>{call.write({contents:JSON.stringify({config:{status:'Not Authorized'}})});});call.on('error',()=>{});});
 const stream=new ClovaStream({secret:'not-used',endpoint,credentials:grpc.credentials.createInsecure()});
 await assert.rejects(stream.start(),/CLOVA_config_rejected/);assert.equal(stream.closed,true);assert.equal(stream.ready,false);
});
test('missing final sequence times out instead of promoting partial speech to a final result',async t=>{
 const endpoint=await localServer(t,call=>{call.on('data',m=>{if(m.type==='CONFIG')call.write({contents:JSON.stringify({config:{status:'Success'}})});});call.on('end',()=>call.end());});
 const stream=new ClovaStream({secret:'not-used',endpoint,credentials:grpc.credentials.createInsecure(),resultTimeoutMs:40});t.after(()=>stream.stop());
 await stream.start();await stream.write(Buffer.alloc(160,255),{final:true});await assert.rejects(stream.finish(),/CLOVA_result_timeout/);
});
test('CLOVA revises transcript suffixes and rejects gaps instead of inventing text',()=>{
 const stream=new ClovaStream({secret:'not-used'});stream.receive({transcription:{text:'가로동',position:0}});stream.receive({transcription:{text:'등',position:2}});assert.equal(stream.text,'가로등');
 assert.throws(()=>stream.receive({transcription:{text:'추가',position:99}}),/invalid_transcript_position/);stream.stop();
});
test('CLOVA file recheck sends sync Korean recognition and real 16 kHz WAV',async()=>{
 const file=new ClovaFile({secret:'not-used',invokeUrl:'https://clovaspeech-gw.ncloud.com/external/v1/1/key',fetcher:async(url,options)=>{
   assert.equal(url,'https://clovaspeech-gw.ncloud.com/external/v1/1/key/recognizer/upload');assert.equal(options.redirect,'error');
   assert.equal(options.headers['X-CLOVASPEECH-API-KEY'],'not-used');const params=JSON.parse(options.body.get('params'));assert.equal(params.completion,'sync');assert.equal(params.language,'ko-KR');
   const wave=readWav(Buffer.from(await options.body.get('media').arrayBuffer()));assert.equal(wave.rate,16000);return new Response(JSON.stringify({result:'SUCCEEDED',text:'가로등 점검'}));
 }});assert.equal(await file.verifyAudio(Buffer.alloc(160,255)),'가로등 점검');
});
test('Gemini uses stateless structured Interactions API and identical evidence validation',async()=>{
 const source='네 가족을 가만두지 않겠다';
 const p=new GeminiPipeline({apiKey:'not-used',fetcher:async(url,options)=>{
   assert.equal(url,'https://generativelanguage.googleapis.com/v1beta/interactions');const b=JSON.parse(options.body);
   assert.equal(b.store,false);assert.equal(b.model,'gemini-3.5-flash-lite');assert.equal(b.generation_config.thinking_level,'minimal');assert.equal(b.response_format.mime_type,'application/json');assert.equal(JSON.parse(b.input).partial,true);
   return completed({directAbuse:true,scope:'direct_attack',category:'threat',evidence:source,attackTarget:'officer',targetEvidence:'네 가족'});
 }});assert.equal((await p.checkSafety(source,{partial:true})).directAbuse,true);
 p.fetcher=async()=>completed({directAbuse:true,scope:'direct_attack',category:'threat',evidence:'만들어낸 발췌',attackTarget:'officer',targetEvidence:'네 가족'});assert.equal((await p.checkSafety(source)).directAbuse,false);
});
test('Gemini refusal or incomplete output never masquerades as normal speech',async()=>{
 const p=new GeminiPipeline({apiKey:'not-used',fetcher:async()=>new Response(JSON.stringify({status:'failed',error:{message:'sensitive data must not be logged'}}))});
 await assert.rejects(p.checkSafety('발화'),/Gemini_response_not_completed/);
 p.fetcher=async()=>new Response(JSON.stringify({status:'completed',steps:[]}));await assert.rejects(p.checkSafety('발화'),/Gemini_empty_structured_result/);
});
test('Gemini quoted harm and legitimate protection requests survive semantic verification',async()=>{
 const transcript='타인에게 협박을 당했습니다. 보호해 주세요';
 const p=new GeminiPipeline({apiKey:'not-used',fetcher:async(url,options)=>{
   const b=JSON.parse(options.body),input=JSON.parse(b.input);
   if(b.response_format.schema.properties.facts)return completed({facts:[{kind:'other',value:'제3자 협박 피해',evidence:'타인에게 협박을 당했습니다'},{kind:'request',value:'피해자 보호',evidence:'보호해 주세요'}]});
   assert.equal(input.facts.length,2);return completed({items:[{id:0,role:'reported_harm'},{id:1,role:'protection_request'}]});
 }});const r=await p.neutralize(transcript);assert.equal(r.facts.length,2);assert.match(r.text,/피해자 보호/);
});
test('Gemini cancellation reaches fetch and provider failure never falls back to OpenAI',async()=>{
 const controller=new AbortController(),p=new GeminiPipeline({apiKey:'not-used',fetcher:async(url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))});
 const request=p.checkSafety('발화',{signal:controller.signal});controller.abort();await assert.rejects(request,{name:'AbortError'});
 p.fetcher=async()=>new Response('{}',{status:429});await assert.rejects(p.checkSafety('발화'),/Gemini_HTTP_429/);
});
test('preflight reports missing settings without network calls or printing credential values',()=>{
 const c=comparisonConfiguration({GEMINI_API_KEY:'private-key'});assert.deepEqual(c.missing,['CLOVA_STREAM_SECRET_KEY']);assert.equal(JSON.stringify(c).includes('private-key'),false);
 assert.equal(comparisonConfiguration({GEMINI_API_KEY:'private-key'},{textOnly:true}).ready,true);
});

test('completed-audio recheck opens a fresh gRPC session and flushes the last real frame',async t=>{
 let requests=0;const endpoint=await localServer(t,call=>{
   requests++;call.on('data',m=>{
     if(m.type==='CONFIG')call.write({contents:JSON.stringify({config:{status:'Success'}})});
     else{const extra=JSON.parse(m.data.extra_contents);if(extra.epFlag)call.write({contents:JSON.stringify({transcription:{text:'재확인 결과',position:0,epFlag:true,seqId:extra.seqId}})});}
   });call.on('end',()=>call.end());
 });
 const verifier=new ClovaRecheck({secret:'not-used',endpoint,credentials:grpc.credentials.createInsecure()});
 assert.equal(await verifier.verifyAudio(Buffer.alloc(9000,255)),'재확인 결과');assert.equal(await verifier.verifyAudio(Buffer.alloc(160,255)),'재확인 결과');assert.equal(requests,2);
});
