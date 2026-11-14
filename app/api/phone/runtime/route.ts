import {registeredPhoneEndpoint} from '../../../../lib/phone-registration';
import {database} from '../../../../lib/database';
export const dynamic='force-dynamic';
export async function POST(request:Request){
  const body=await request.text();
  const endpoint=registeredPhoneEndpoint(body,request.headers.get('x-phone-signature'),process.env.PHONE_BRIDGE_SECRET,Date.now(),process.env.PHONE_BRIDGE_HOSTS);
  if(!endpoint)return Response.json({error:'Unauthorized runtime registration'},{status:403});
  try{
    const health=await fetch(endpoint+'/health',{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(6000)});
    const info=await health.json();if(!health.ok||info.ready!==true||info.transport!=='web')throw Error('offline');
    await database().prepare("INSERT INTO phone_runtime(id,endpoint,updated_at) VALUES('main',?,NOW()) ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint,updated_at=NOW()").bind(endpoint).run();
    return Response.json({registered:true},{headers:{'Cache-Control':'no-store'}});
  }catch{return Response.json({error:'Runtime not reachable or registration store unavailable'},{status:503});}
}
