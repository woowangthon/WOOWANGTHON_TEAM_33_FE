// Experimental phone-only provider. Shares source/evidence checks with TextPipeline.
import {TextPipeline} from './text-pipeline.mjs';
import {checkTargetSafety} from './target-policy.mjs';
export {groundedTarget} from './target-policy.mjs';
export class GeminiPipeline extends TextPipeline {
  constructor({apiKey,model='gemini-3.5-flash-lite',thinkingLevel='minimal',audioVerifier,fetcher=fetch}){
    if(!apiKey)throw Error('Gemini_key_missing');
    super({apiKey,model,fetcher});Object.assign(this,{thinkingLevel,audioVerifier});
  }
  checkSafety(...args){return checkTargetSafety(this,...args);}
  async structured(name,schema,instructions,input,maxOutputTokens,{signal}={}){
    const started=performance.now();
    const response=await this.fetcher('https://generativelanguage.googleapis.com/v1beta/interactions',{
      method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':this.key,'Api-Revision':'2026-05-20'},
      body:JSON.stringify({model:this.model,store:false,system_instruction:instructions,input:JSON.stringify(input),response_format:{type:'text',mime_type:'application/json',schema},generation_config:{thinking_level:this.thinkingLevel,max_output_tokens:Math.max(1024,maxOutputTokens)}}),
      redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000),
    });
    if(!response.ok){
      const error=Error('Gemini_HTTP_'+response.status);
      if(response.status===429){let seconds=Number(response.headers.get('retry-after'));if(!seconds)try{const body=await response.json();const detail=body.error?.details?.find(d=>typeof d.retryDelay==='string');seconds=Number(detail?.retryDelay?.replace(/s$/,''));}catch{}error.retryAfterMs=Number.isFinite(seconds)&&seconds>0?seconds*1000:30000;}
      throw error;
    }
    const data=await response.json();
    if(data.status!=='completed')throw Error('Gemini_response_not_completed');
    const output=data.steps?.filter(step=>step.type==='model_output').at(-1);
    const text=output?.content?.filter(block=>block.type==='text').map(block=>block.text||'').join('');
    if(!text)throw Error('Gemini_empty_structured_result');
    const result=JSON.parse(text);
    this.usage.push({endpoint:'gemini/interactions',name,model:this.model,elapsedMs:Math.round(performance.now()-started),usage:data.usage||null});
    return result;
  }
  verifyAudio(muLaw){if(!this.audioVerifier)throw Error('CLOVA_file_verifier_missing');return this.audioVerifier.verifyAudio(muLaw);}
}
