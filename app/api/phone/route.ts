import { createHmac, randomUUID } from 'node:crypto';
import { getCurrentUser } from '../../user';
import { rateLimit } from '../../../lib/server';
import {createGuestSession,guestCookie,guestMaxAge} from '../../../lib/guest';
import {publicStaffInbox} from '../../../lib/access';
import {NextResponse} from 'next/server';
import {phoneEndpoint} from '../../../lib/phone-runtime';
export const dynamic='force-dynamic';
export async function GET(){
  const url=await phoneEndpoint();let online=false;
  if(url)try{ const r=await fetch(new URL('/health',url),{cache:'no-store',signal:AbortSignal.timeout(4500)});online=r.ok&&(await r.json()).ready===true;}catch{}
  return Response.json({online,number:process.env.PHONE_NUMBER||null},{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:Request){
  try{
    const origin=request.headers.get('origin'),expected=new URL(request.url).origin;
    const localPreview=process.env.NODE_ENV==='development'&&expected==='http://localhost:3100'&&origin==='http://127.0.0.1:3100';
    if(origin!==expected&&!localPreview)return Response.json({error:'허용되지 않은 요청입니다.'},{status:403});
    const input=await request.text();
    if(input.length>1000)return Response.json({error:'요청 크기를 초과했습니다.'},{status:413});
    const demo=JSON.parse(input||'{}').demo===true;
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
    const payload=Buffer.from(JSON.stringify({role,demo,owner:user.userId,exp:Math.floor(Date.now()/1000)+120,nonce:randomUUID()})).toString('base64url');
    const token=payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
    url.pathname='/connect';url.protocol=url.protocol==='https:'?'wss:':'ws:';
    const response=NextResponse.json({url:url.toString(),token,role},{headers:{'Cache-Control':'no-store'}});
    if(newCookie)response.cookies.set(guestCookie,newCookie,{httpOnly:true,secure:new URL(request.url).protocol==='https:',sameSite:'lax',path:'/',maxAge:guestMaxAge});
    return response;
  }catch{return Response.json({error:'통화 연결을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.'},{status:503});}
}
