import { AppError } from './server';
export type AIConfig={provider?:string;model:string;openai:string};
// Credentials stay in the step process and never enter workflow arguments or logs.
export async function structuredAI(keys:AIConfig,name:string,instructions:string,input:unknown,schema:unknown,images:{mime:string;base64:string}[]=[],options:{reasoningEffort?:'low'|'medium';maxOutputTokens?:number}={}) {
  if(keys.provider&&keys.provider!=='openai')throw new AppError('OpenAI 분석 설정을 확인해 주세요.',503,false);
  const key=keys.openai;
  if(!key)throw new AppError('AI 분석 연결을 확인해 주세요.',503,false);
  let response:Response;
  try {response=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',signal:AbortSignal.timeout(65000),headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},
    body:JSON.stringify({model:keys.model,instructions,input:images.length?[{role:'user',content:[{type:'input_text',text:JSON.stringify(input)},...images.map(i=>({type:'input_image',image_url:`data:${i.mime};base64,${i.base64}`,detail:'low'}))]}]:JSON.stringify(input),reasoning:{effort:options.reasoningEffort||'low'},text:{format:{type:'json_schema',name,strict:true,schema}},max_output_tokens:options.maxOutputTokens||4096,store:false})
  });}catch{throw new AppError('분석 응답이 지연되었습니다. 잠시 후 자동으로 다시 시도합니다.',504);}
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const quota=['insufficient_quota','credit_balance_exhausted'].includes(data?.error?.code)||data?.error?.type==='insufficient_quota';
    if(quota)throw new AppError('AI 분석 서비스의 잔액 또는 사용 한도를 확인해야 합니다.',503,false);
    throw new AppError('분석 요청을 완료하지 못했습니다.',response.status===429?429:502,![400,401,403,404].includes(response.status));
  }
  const parts=(data?.output||[]).filter((p:{type:string})=>p.type==='message').flatMap((p:{content:unknown[]})=>p.content||[]);
  if(data?.status!=='completed'||parts.some((p:{type:string})=>p.type==='refusal'))throw new AppError('분석 응답이 완료되지 않았습니다.',502);
  const text=parts.filter((p:{type:string})=>p.type==='output_text').map((p:{text:string})=>p.text).join('');
  try{return JSON.parse(text);}catch{throw new AppError('분석 응답 형식을 확인하지 못했습니다.',502);}
}
