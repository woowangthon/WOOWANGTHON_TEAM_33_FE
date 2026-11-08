import { RetryableError } from 'workflow';
import { runAnalysisStage,failAnalysis,type Stage } from '../lib/analysis-stages';

export async function analyzeComplaint(id:string,generation:number) {
  'use workflow';
  try {
    for(const stage of ['plan','evidence','analysis','requirements','review','coverage','finish'] as const) {
      if(!await executeStage(id,generation,stage))return {cancelled:true};
    }
    return {completed:true};
  } catch {await markFailed(id,generation);return {completed:false};}
}
async function executeStage(id:string,generation:number,stage:Stage) {
  'use step';
  try{return await runAnalysisStage(id,generation,stage);}
  catch{throw new RetryableError('Analysis stage temporarily unavailable',{retryAfter:'15s'});}
}
executeStage.maxRetries=3;
async function markFailed(id:string,generation:number) {
  'use step';
  await failAnalysis(id,generation);
}
