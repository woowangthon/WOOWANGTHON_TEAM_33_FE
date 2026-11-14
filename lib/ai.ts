import type { SummaryFact,SummaryAudit } from './summary-harness';
import { generateOpenAIAnalysis } from './openai';
import { AppError } from './server';
import type { Analysis, Citation, Complaint } from './types';

export function generateAnalysis(key:string,model:string,c:Complaint,citations:Citation[],warnings:string[],mode:string,provider='openai',facts:SummaryFact[]=[],previousValidation:SummaryAudit['attempts']=[]):Promise<Analysis> {
  if(provider!=='openai')throw new AppError('OpenAI 분석 설정을 확인해 주세요.',503,false);
  return generateOpenAIAnalysis(key,model,c,citations,warnings,mode,facts,previousValidation);
}
