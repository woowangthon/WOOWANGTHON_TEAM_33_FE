import { AppError } from './server';
export type AIConfig={provider:string;model:string;openai:string;gemini:string};
// Credentials stay in the step process and never enter workflow arguments or logs.
export async function structuredAI(keys:AIConfig,name:string,instructions:string,input:unknown,schema:unknown,images:{mime:string;base64:string}[]=[]) {
  const openai=keys.provider==='openai',key=openai?keys.openai:keys.gemini;
  if(!key)throw new AppError('AI 분석 연결을 확인해 주세요.',503);
  let response:Response;
  try {response=await fetch(openai?'https://api.openai.com/v1/responses':`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(keys.model)}:generateContent`,{
    method:'POST',signal:AbortSignal.timeout(65000),headers:openai?{'Content-Type':'application/json',Authorization:`Bearer ${key}`}:{'Content-Type':'application/json','x-goog-api-key':key},
    body:JSON.stringify(openai?{model:keys.model,instructions,input:images.length?[{role:'user',content:[{type:'input_text',text:JSON.stringify(input)},...images.map(i=>({type:'input_image',image_url:`data:${i.mime};base64,${i.base64}`,detail:'low'}))]}]:JSON.stringify(input),reasoning:{effort:'low'},text:{format:{type:'json_schema',name,strict:true,schema}},max_output_tokens:4096,store:false}:{systemInstruction:{parts:[{text:instructions}]},contents:[{role:'user',parts:[{text:JSON.stringify(input)},...images.map(i=>({inlineData:{mimeType:i.mime,data:i.base64}}))]}],generationConfig:{responseMimeType:'application/json',responseJsonSchema:schema,maxOutputTokens:4096}})
  });}catch{throw new AppError('분석 응답이 지연되었습니다. 잠시 후 자동으로 다시 시도합니다.',504);}
  if(!response.ok)throw new AppError('분석 요청을 완료하지 못했습니다.',response.status===429?429:502);
  const data=await response.json();
  let text='';
  if(openai){if(data.status!=='completed')throw new AppError('분석 응답이 완료되지 않았습니다.',502);text=(data.output||[]).filter((p:{type:string})=>p.type==='message').flatMap((p:{content:unknown[]})=>p.content||[]).filter((p:{type:string})=>p.type==='output_text').map((p:{text:string})=>p.text).join('');}
  else {const c=data.candidates?.[0];if(c?.finishReason!=='STOP')throw new AppError('분석 응답이 완료되지 않았습니다.',502);text=(c.content?.parts||[]).filter((p:{thought?:boolean})=>!p.thought).map((p:{text:string})=>p.text||'').join('');}
  try{return JSON.parse(text);}catch{throw new AppError('분석 응답 형식을 확인하지 못했습니다.',502);}
}
