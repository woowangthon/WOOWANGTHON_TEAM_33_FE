import { AppError } from './server';
import { analysisInstruction, jsonSchema, validateAnalysis } from './gemini';
import type { Analysis, Citation, Complaint } from './types';

type OpenAIResponse = {
  status?: string;
  output?: { type: string; content?: { type: string; text?: string }[] }[];
  error?: { code?: string; type?: string };
};

export async function generateOpenAIAnalysis(key:string, model:string, c:Complaint, citations:Citation[], warnings:string[], mode:string):Promise<Analysis> {
  if (!key) throw new AppError('현재 AI 분석을 사용할 수 없습니다.', 503);
  const body=JSON.stringify({
    model,
    instructions:analysisInstruction,
    input:JSON.stringify({complaint:{title:c.title,body:c.body,location:c.location,category:c.category,occurredAt:c.occurred_at},retrievedArticles:citations}),
    reasoning:{effort:'low'},
    text:{format:{type:'json_schema',name:'complaint_analysis',strict:true,schema:jsonSchema}},
    max_output_tokens:8192,
    store:false,
  });
  let response:Response;
  try {
    const signal=AbortSignal.timeout(75000);
    const request=()=>fetch('https://api.openai.com/v1/responses',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body,signal,
    });
    response=await request();
    if ([500,502,503,504].includes(response.status)) {
      await response.body?.cancel();
      await new Promise(resolve=>setTimeout(resolve,1000));
      signal.throwIfAborted();
      response=await request();
    }
  } catch { throw new AppError('AI 응답이 지연되었습니다. 민원 원문은 저장되어 있으니 다시 분석해 주세요.',504); }
  const data=await response.json().catch(()=>null) as OpenAIResponse|null;
  if (!response.ok) {
    if (response.status===429) {
      if (data?.error?.type==='insufficient_quota'||['insufficient_quota','credit_balance_exhausted'].includes(data?.error?.code||'')) {
        throw new AppError('AI 분석 서비스의 이용 잔액 또는 사용 한도가 부족합니다. 접수 원문과 검색 근거는 보존됩니다.',503);
      }
      throw new AppError('AI 분석 요청이 많습니다. 잠시 후 다시 시도해 주세요.',429);
    }
    if ([401,403].includes(response.status)) throw new AppError('AI 분석 서비스의 인증 또는 모델 접근 권한을 확인해야 합니다.',503);
    if (response.status===404) throw new AppError('현재 AI 분석 모델을 사용할 수 없습니다.',503);
    throw new AppError('AI 분석 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.',502);
  }
  const parts=data?.output?.filter(item=>item.type==='message').flatMap(item=>item.content||[])||[];
  if (data?.status!=='completed'||parts.some(part=>part.type==='refusal')) {
    throw new AppError('AI가 분석을 완료하지 못했습니다. 잘못된 결과는 저장하지 않았습니다.',502);
  }
  return validateAnalysis(parts.filter(part=>part.type==='output_text').map(part=>part.text||'').join(''),model,c,citations,warnings,mode);
}
