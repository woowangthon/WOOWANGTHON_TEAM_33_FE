import { createHmac, randomUUID } from 'node:crypto';
import { getCurrentUser } from '../../user';
import { rateLimit } from '../../../lib/server';
import {createGuestSession,guestCookie,guestMaxAge} from '../../../lib/guest';
import {publicStaffInbox} from '../../../lib/access';
import {NextResponse} from 'next/server';
import {phoneEndpoint} from '../../../lib/phone-runtime';
export const dynamic='force-dynamic';
export async function GET(request:Request){
  if(new URL(request.url).searchParams.get('history')==='1'){
    const user=await getCurrentUser();
    if(process.env.SITE_MODE!=='staff'||(!user?.isStaff&&!publicStaffInbox()))return Response.json({error:'담당자 인증이 필요합니다.'},{status:401});
    const endpoint=await phoneEndpoint(),secret=process.env.PHONE_BRIDGE_SECRET;
    if(!endpoint||!secret)return Response.json({error:'상담 목록을 불러오지 못했습니다.'},{status:503});
    const payload=Buffer.from(JSON.stringify({role:'staff',scope:'history',exp:Math.floor(Date.now()/1000)+30,nonce:randomUUID()})).toString('base64url');
    const token=payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
    try{
      const result=await fetch(new URL('/history',endpoint),{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:AbortSignal.timeout(6000)});
      if(!result.ok)throw Error('History_unavailable');
      return Response.json(await result.json(),{headers:{'Cache-Control':'no-store'}});
    }catch{return Response.json({error:'상담 목록을 불러오지 못했습니다.'},{status:503});}
  }
  const url=await phoneEndpoint();let online=false,available=false;
  if(url)try{ const r=await fetch(new URL('/health',url),{cache:'no-store',signal:AbortSignal.timeout(4500)});const data=await r.json();online=r.ok&&data.ready===true;available=online&&data.acceptingCalls===true;}catch{}
  return Response.json({online,available,transport:'web'},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request){
  try{
    const origin=request.headers.get('origin'),expected=new URL(request.url).origin;
    const localPreview=process.env.NODE_ENV==='development'&&expected==='http://localhost:3100'&&origin==='http://127.0.0.1:3100';
    if(origin!==expected&&!localPreview)return Response.json({error:'허용되지 않은 요청입니다.'},{status:403});
    const input=await request.text();
    if(input.length>1000)return Response.json({error:'요청 크기를 초과했습니다.'},{status:413});
    const parsed=JSON.parse(input||'{}');
    if(parsed.demo===true)return Response.json({error:'실제 상담 연결을 이용해 주세요.'},{status:400});
    const nickname=typeof parsed.nickname==='string'?parsed.nickname.trim().replace(/\s+/g,' '):'';
    if(process.env.SITE_MODE!=='staff'&&(!nickname||nickname.length>30||/[\u0000-\u001f\u007f]/.test(nickname)))return Response.json({error:'닉네임을 1~30자로 입력해 주세요.'},{status:400});
    let user=await getCurrentUser(),newCookie:string|undefined;
    if(!user){
      if(process.env.SITE_MODE==='staff'&&!publicStaffInbox())return Response.json({error:'담당자 인증이 필요합니다.'},{status:401});
      await rateLimit('phone-start:'+(request.headers.get('x-forwarded-for')?.split(',')[0]||'unknown'),'create',15);
      const owner='guest:'+randomUUID();newCookie=await createGuestSession(owner);user={userId:owner,isStaff:true,isGuest:true,email:'',fullName:'작업공간',emailVerified:false};
    }
    const url=await phoneEndpoint(),secret=process.env.PHONE_BRIDGE_SECRET;
    if(!url||!secret)return Response.json({error:'통화 연결을 준비하고 있습니다.'},{status:503});
    const role=process.env.SITE_MODE==='staff'&&user.isStaff?'staff':'caller';
    if(process.env.SITE_MODE==='staff'&&role!=='staff')return Response.json({error:'담당자 권한이 필요합니다.'},{status:403});
    await rateLimit(user.userId,'phone-ticket',30);
    const payload=Buffer.from(JSON.stringify({role,demo:false,nickname:role==='caller'?nickname:undefined,owner:user.userId,exp:Math.floor(Date.now()/1000)+120,nonce:randomUUID()})).toString('base64url');
    const token=payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
    url.pathname='/connect';url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const response=NextResponse.json({url:url.toString(),token,role},{headers:{'Cache-Control':'no-store'}});
    if(newCookie)response.cookies.set(guestCookie,newCookie,{httpOnly:true,secure:new URL(request.url).protocol==='https:',sameSite:'lax',path:'/',maxAge:guestMaxAge});
    return response;
  }catch{return Response.json({error:'통화 연결을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'},{status:503});}
}
