import {timingSafeEqual} from 'node:crypto';
import {phoneEndpoint} from '../../../../lib/phone-runtime';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  const token=new URL(request.url).searchParams.get('token')||'',expected=process.env.PHONE_PROVIDER_TOKEN||'';
  const a=Buffer.from(token),b=Buffer.from(expected);
  if(!b.length||a.length!==b.length||!timingSafeEqual(a,b))return new Response('Forbidden',{status:403});
  try{
    const url=await phoneEndpoint();if(!url)throw new Error('offline');
    const body=await request.text();if(body.length>16000)return new Response('Too large',{status:413});
    url.pathname='/provider/voice';url.searchParams.set('token',expected);
    const response=await fetch(url,{method:'POST',headers:{'Content-Type':request.headers.get('content-type')||'application/x-www-form-urlencoded'},body,cache:'no-store',signal:AbortSignal.timeout(6000)});
    if(!response.ok)throw new Error('offline');return new Response(await response.text(),{headers:{'Content-Type':'application/xml','Cache-Control':'no-store'}});
  }catch{return new Response('<Response><Say>지금은 상담 연결이 어렵습니다. 잠시 후 다시 전화해 주세요.</Say><Hangup/></Response>',{headers:{'Content-Type':'application/xml','Cache-Control':'no-store'}});}
}
