import { generateAnalysis as generateGeminiAnalysis } from './gemini';
import { generateOpenAIAnalysis } from './openai';
import type { Analysis, Citation, Complaint } from './types';

export function generateAnalysis(key:string,model:string,c:Complaint,citations:Citation[],warnings:string[],mode:string,provider='gemini'):Promise<Analysis> {
  return provider==='openai'
    ? generateOpenAIAnalysis(key,model,c,citations,warnings,mode)
    : generateGeminiAnalysis(key,model,c,citations,warnings,mode);
}
