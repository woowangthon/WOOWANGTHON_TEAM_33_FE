import { Client } from 'pg';
import { getCurrentUser } from '../../user';
import { officeForOwner,publicStaffInbox } from '../../../lib/access';
import { notificationForOffice } from '../../../lib/complaint-notifications';

export const dynamic='force-dynamic';
export const maxDuration=180;

export async function GET(request:Request) {
  const user=await getCurrentUser();
  if(process.env.SITE_MODE!=='staff'||!user?.isStaff||(user.isGuest&&!publicStaffInbox()))return new Response(null,{status:403});
  if(request.headers.get('sec-fetch-site')==='cross-site')return new Response(null,{status:403});
  const connection=process.env.DATABASE_URL_UNPOOLED;
  if(!connection)return new Response(null,{status:503});
  const office=officeForOwner(user.userId),url=new URL(connection);
  url.searchParams.set('sslmode','verify-full');
  const client=new Client({connectionString:url.toString(),connectionTimeoutMillis:10000,keepAlive:true});
  const encoder=new TextEncoder();
  let closed=false,controller:ReadableStreamDefaultController<Uint8Array>|undefined;
  let heartbeat:ReturnType<typeof setInterval>|undefined,expiry:ReturnType<typeof setTimeout>|undefined;
  const finish=()=>{
    if(closed)return;closed=true;
    clearInterval(heartbeat);clearTimeout(expiry);request.signal.removeEventListener('abort',finish);
    try{controller?.close();}catch{}
    void client.end().catch(()=>{});
  };
  const send=(event:string,value:unknown)=>{
    if(closed||!controller)return;
    try{controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));}catch{finish();}
  };
  client.on('error',()=>{console.warn('Complaint notification connection interrupted.');finish();});
  // Notifications during LISTEN setup are reconciled by the ready snapshot below.
  client.on('notification',message=>{
    const event=notificationForOffice(message.payload,office);if(event)send('complaint',event);
  });
  request.signal.addEventListener('abort',finish,{once:true});
  try{await client.connect();await client.query('LISTEN complaint_changes');}
  catch{finish();return new Response(null,{status:503});}
  if(closed||request.signal.aborted){finish();return new Response(null,{status:204});}
  const stream=new ReadableStream<Uint8Array>({
    start(c){
      controller=c;
      c.enqueue(encoder.encode('retry: 3000\n\n'));
      // LISTEN is committed before asking the browser for its initial/reconnect snapshot.
      send('ready',{});
      // Keep the transport open, without querying the database or AI.
      heartbeat=setInterval(()=>{if(!closed)try{c.enqueue(encoder.encode(': keepalive\n\n'));}catch{finish();}},25000);
      expiry=setTimeout(()=>{send('reconnect',{});finish();},165000);
    },
    cancel(){finish();}
  });
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','Cache-Control':'private, no-cache, no-transform','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'}});
}
