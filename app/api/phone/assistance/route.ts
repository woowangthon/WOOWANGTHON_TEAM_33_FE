import {getCurrentUser} from '../../../user';
import {credentials,database,rateLimit,AppError} from '../../../../lib/server';
import {officeForOwner} from '../../../../lib/access';
import {retrieve,type StoredDoc} from '../../../../lib/laws';
import {assistanceInput,generateAssistance} from '../../../../lib/phone-assistance';

export const dynamic='force-dynamic';
export const maxDuration=30;
const documents=new Map<string,{until:number;pending:Promise<StoredDoc[]>}>();
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
  const docs=await Promise.race([cachedDocuments(office).catch(()=>null),new Promise<null>(resolve=>{timer=setTimeout(()=>resolve(null),1000);})]).finally(()=>clearTimeout(timer));
  const source={title:'음성 상담',body:input.segments.map(s=>s.text).join('\n'),category:'기타',occurred_at:'',location:input.segments.flatMap(s=>s.facts).find(f=>f.kind==='location')?.value||''};
  const found=docs?retrieve(docs,source,undefined,5):{citations:[],warnings:['자료 조회가 지연되어 확정된 근거 없이 초안을 작성했습니다.']};
  const citations=found.citations.filter(c=>{try{const u=new URL(c.sourceUrl);return u.protocol==='https:'&&(u.hostname==='law.go.kr'||u.hostname.endsWith('.law.go.kr'));}catch{return false;}}).map(c=>({...c,text:c.text.slice(0,6000)}));
  const result=await generateAssistance(input,citations,config,request.signal);
  result.warnings=[...new Set([...result.warnings,...found.warnings])];
  return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(error){
  const status=error instanceof AppError?error.status:error instanceof SyntaxError?400:error instanceof DOMException?504:502;
  return Response.json({error:status===429?'요청이 많습니다. 잠시 후 다시 시도해 주세요.':status===400?'상담 입력 형식을 확인해 주세요.':status===504?'답변 생성이 지연되었습니다. 다시 시도해 주세요.':'답변을 확인하지 못했습니다. 다시 시도해 주세요.'},{status,headers:{'Cache-Control':'no-store'}});
 }
}
