import {database} from './database';
export async function phoneEndpoint(){
  let value=process.env.PHONE_BRIDGE_URL;
  try{const row=await database().prepare("SELECT endpoint FROM phone_runtime WHERE id='main'").first<{endpoint:string}>();if(row)value=row.endpoint;}catch{}
  if(!value)return null;
  const url=new URL(value);
  if(url.protocol!=='https:'&&url.hostname!=='127.0.0.1')return null;
  return url;
}
