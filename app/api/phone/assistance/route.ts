import {getCurrentUser} from '../../../user';
import {credentials,database,rateLimit,AppError} from '../../../../lib/server';
import {officeForOwner} from '../../../../lib/access';
import {retrieve,autoSync,type StoredDoc} from '../../../../lib/laws';
import {phoneLawPlan} from '../../../../lib/phone-law-search';
import {assistanceInput,assistanceTranscript,generateAssistance,AssistanceProviderError} from '../../../../lib/phone-assistance';

export const dynamic='force-dynamic';
export const maxDuration=60;
const documents=new Map<string,{until:number;pending:Promise<StoredDoc[]>}>();
let geminiBackoffUntil=0;
function cachedDocuments(owner:string){
 const cached=documents.get(owner);if(cached&&cached.until>Date.now())return cached.pending;
 const pending=database().prepare('SELECT * FROM documents WHERE owner=?').bind(owner).all<StoredDoc>().then(r=>r.results).catch(error=>{documents.delete(owner);throw error;});
 if(documents.size>50)documents.clear();documents.set(owner,{until:Date.now()+60000,pending});return pending;
}
export async function POST(request:Request){
 try{
  if(request.headers.get('origin')!==new URL(request.url).origin)return Response.json({error:'허용되지 않은 요청입니다.'},{status:403});
  const user=await getCurrentUser();
  if(process.env.SITE_MODE!=='staff'||!user?.isStaff)return Response.json({error:'담당자 인증이 필요합니다.'},{status:401});
  const body=await request.text();if(body.length>60000)return Response.json({error:'상담 내용이 너무 깁니다.'},{status:413});
  const parsed=assistanceInput.safeParse(JSON.parse(body));if(!parsed.success)return Response.json({error:'확정된 상담 내용을 확인해 주세요.'},{status:400});
  const input=parsed.data,office=officeForOwner(user.userId);
  await rateLimit(user.userId,'phone-assistance',300);
  const keys=await credentials(office),gemini=process.env.SERVICE_GEMINI_API_KEY;
  const provider=process.env.PHONE_ASSIST_PROVIDER==='openai'?'openai':process.env.PHONE_ASSIST_PROVIDER==='gemini'||gemini?'gemini':'openai';
  const config={provider,key:provider==='gemini'?gemini!:keys.openai,model:process.env.PHONE_ASSIST_MODEL||(provider==='gemini'?'gemini-3.5-flash-lite':keys.model)} as const;
  if(!config.key)return Response.json({error:'답변 생성 서비스 연결을 확인해 주세요.'},{status:503});
  let timer:ReturnType<typeof setTimeout>|undefined;
  let docs=await Promise.race([cachedDocuments(office).catch(()=>null),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),5000);})]).finally(()=>clearTimeout(timer));
  const source={title:'음성 상담',body:assistanceTranscript(input),category:'기타',occurred_at:'',location:input.segments.flatMap(s=>s.facts).find(f=>f.kind==='location')?.value||''};
  let plan;const searchWarnings:string[]=[];
  if(keys.law&&keys.openai){
   try{plan=await phoneLawPlan(keys,source.body);searchWarnings.push(...await autoSync(office,keys.law,'기타',source,plan));documents.delete(office);docs=await cachedDocuments(office);}catch(error){searchWarnings.push(error instanceof AppError?error.message:'법령 검색 계획을 확인하지 못했습니다.');}
  }
  if(searchWarnings.length)console.warn('Phone law search incomplete',{warnings:searchWarnings,documentCount:docs?.length||0});
  // Search generated legal synonyms as well as the spoken wording. They are
  // retrieval hints only and are never added to the caller's facts or transcript.
  const retrievalInput={...source,body:[source.body,...(plan?.terms||[])].join('\n')};
  const found=docs?retrieve(docs,retrievalInput,plan,16):{citations:[],warnings:['자료 조회가 지연되어 확정된 근거 없이 초안을 작성했습니다.']};
  const citations=found.citations.filter(c=>{try{const u=new URL(c.sourceUrl);return u.protocol==='https:'&&(u.hostname==='law.go.kr'||u.hostname.endsWith('.law.go.kr'));}catch{return false;}}).map(c=>({...c,text:c.text.slice(0,6000)}));
  console.info('Phone law retrieval',{plannedSources:plan?.sources,documentCount:docs?.length||0,candidates:citations.map(c=>({title:c.title,article:c.article}))});
  const fallback={provider:'openai' as const,key:keys.openai,model:keys.model};
  let result;
  try{result=await generateAssistance(input,citations,provider==='gemini'&&geminiBackoffUntil>Date.now()&&keys.openai?fallback:config,request.signal);}
  catch(error){
   if(provider!=='gemini'||!keys.openai||!(error instanceof AssistanceProviderError)||!(error.status===429||error.status>=500)||request.signal.aborted)throw error;
   // Do not expose upstream payloads, transcripts or keys in logs.
   console.warn('Phone assistance provider fallback',{from:'gemini',status:error.status});
   geminiBackoffUntil=Date.now()+60000;
   result=await generateAssistance(input,citations,fallback,request.signal);
  }
  result.warnings=[...new Set([...result.warnings,...found.warnings,...searchWarnings])];
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  console.warn('Phone assistance failed',{kind:error instanceof Error?error.name:'unknown',providerStatus:error instanceof AssistanceProviderError?error.status:undefined});
  const status=error instanceof AppError?error.status:error instanceof SyntaxError?400:error instanceof DOMException?504:502;
  return Response.json({error:status===429?'요청이 많습니다. 잠시 후 다시 시도해 주세요.':status===400?'상담 입력 형식을 확인해 주세요.':status===504?'답변 생성이 지연되었습니다. 다시 시도해 주세요.':'답변을 확인하지 못했습니다. 다시 시도해 주세요.'},{status,headers:{'Cache-Control':'no-store'}});
 }
}
