import { RetryableError,FatalError } from 'workflow';
import { runAnalysisStage,failAnalysis,prepareSummaryRetry,type Stage } from '../lib/analysis-stages';
import { SummaryRejectedError } from '../lib/summary-harness';

export async function analyzeComplaint(id:string,generation:number) {
  'use workflow';
  try {
    for(let pass=0;;pass++) {
      let rejected=false;
      for(const stage of ['plan','evidence','analysis','summary','reply','finish'] as const) {
        const result=await executeStage(id,generation,stage,pass);
        if(result==='rejected'){rejected=true;break;}
        if(!result)return {cancelled:true};
      }
      if(!rejected)return {completed:true};
      if(!await restartSummary(id,generation,pass+1))break;
    }
    await markFailed(id,generation);return {completed:false};
  } catch(error) {await markFailed(id,generation,error instanceof Error&&/잔액|크레딧/.test(error.message));return {completed:false};}
}
async function executeStage(id:string,generation:number,stage:Stage,pass:number) {
  'use step';
  try{return await runAnalysisStage(id,generation,stage);}
  catch(error){
    console.warn('Analysis stage failed',{id,stage,pass,name:error instanceof Error?error.name:'unknown',status:error&&typeof error==='object'&&'status' in error?error.status:undefined});
    if(error instanceof SummaryRejectedError&&error.restartable)return 'rejected' as const;
    if(error instanceof Error&&'retryable' in error&&error.retryable===false)throw new FatalError(error.message);
    throw new RetryableError('Analysis stage temporarily unavailable',{retryAfter:'15s'});
  }
}
executeStage.maxRetries=3;
async function restartSummary(id:string,generation:number,attempt:number) {
  'use step';
  return prepareSummaryRetry(id,generation,attempt);
}
async function markFailed(id:string,generation:number,quota=false) {
  'use step';
  await failAnalysis(id,generation,quota);
}
