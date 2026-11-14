import {readFile} from 'node:fs/promises';
import {createHmac} from 'node:crypto';
import {parseEnv} from 'node:util';
import {pathToFileURL} from 'node:url';
export async function registerPhone(endpoint,config){
  if(!config.PHONE_STAFF_SITE_URL||!config.PHONE_BRIDGE_SECRET)throw Error('Phone_registration_configuration_missing');
  const target=new URL('/api/phone/runtime',config.PHONE_STAFF_SITE_URL);
  if(target.protocol!=='https:')throw Error('Phone_registration_requires_HTTPS');
  const body=JSON.stringify({endpoint,issuedAt:Date.now()});
  const response=await fetch(target,{method:'POST',headers:{'Content-Type':'application/json','X-Phone-Signature':createHmac('sha256',config.PHONE_BRIDGE_SECRET).update(body).digest('hex')},body,redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!response.ok||(await response.json()).registered!==true)throw Error('Phone_registration_failed_'+response.status);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const config=parseEnv(await readFile(new URL('../.env.phone.local',import.meta.url),'utf8'));
  const state=JSON.parse(await readFile(new URL('../outputs/phone-runtime/state.json',import.meta.url),'utf8'));
  await registerPhone(state.url,config);console.log('Web voice endpoint registered.');
}
