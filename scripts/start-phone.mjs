import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {registerPhone} from './register-phone.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),out=new URL('../outputs/phone-runtime/',import.meta.url);
await mkdir(out,{recursive:true});
const base=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));
let config;try{config=parseEnv(await readFile(new URL('../.env.phone.local',import.meta.url),'utf8'));}catch{config={PHONE_BRIDGE_SECRET:randomBytes(32).toString('hex')};await writeFile(new URL('../.env.phone.local',import.meta.url),'PHONE_BRIDGE_SECRET='+config.PHONE_BRIDGE_SECRET+'\n');}
if(!base.SERVICE_OPENAI_API_KEY&&!base.OPENAI_API_KEY)throw Error('Voice_API_key_missing');
if(!config.PHONE_BRIDGE_SECRET)throw Error('Phone_bridge_secret_missing');
try{const response=await fetch('http://127.0.0.1:4318/health',{signal:AbortSignal.timeout(1500)});if(response.ok)throw Error('Phone_bridge_already_running');}catch(error){if(error.message==='Phone_bridge_already_running')throw error;}
const log=await open(new URL('bridge.log',out),'a');
const bridge=spawn(process.execPath,['phone/server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PHONE_PORT:'4318',PHONE_ALLOWED_ORIGINS:config.PHONE_ALLOWED_ORIGINS||'https://shield-solve-staff.vercel.app,https://shield-and-solve.vercel.app,http://127.0.0.1:3100',PHONE_BRIDGE_SECRET:config.PHONE_BRIDGE_SECRET,SERVICE_OPENAI_API_KEY:base.SERVICE_OPENAI_API_KEY||base.OPENAI_API_KEY,SERVICE_OPENAI_MODEL:base.SERVICE_OPENAI_MODEL||'gpt-6-luna'},stdio:['ignore',log.fd,log.fd]});
await log.close();let tunnel,stopping=false;
const stop=()=>{if(stopping)return;stopping=true;bridge.kill();tunnel?.kill();};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
bridge.on('error',()=>{console.error('Phone bridge could not start.');stop();process.exitCode=1;});
bridge.on('exit',()=>{if(!stopping){stop();process.exitCode=1;}});
try{
  let ready=false;for(let i=0;i<30&&!ready;i++){try{ready=(await fetch('http://127.0.0.1:4318/health',{signal:AbortSignal.timeout(1000)})).ok;}catch{}if(!ready)await delay(200);}
  if(!ready)throw Error('Phone_bridge_start_timeout');
  const tunnelLog=await open(new URL('tunnel.log',out),'w');
  tunnel=spawn(process.env.CLOUDFLARED_PATH||config.CLOUDFLARED_PATH||fileURLToPath(new URL('cloudflared.exe',out)),['tunnel','--no-autoupdate','--url','http://127.0.0.1:4318','--protocol','http2'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let buffer='';
  const url=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error('Tunnel_start_timeout')),45000);
    const receive=data=>{void tunnelLog.write(data);buffer=(buffer+data.toString()).slice(-16000);const match=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(match){clearTimeout(timeout);resolve(match[0]);}};
    tunnel.stdout.on('data',receive);tunnel.stderr.on('data',receive);tunnel.on('error',()=>{clearTimeout(timeout);reject(Error('Tunnel_start_failed'));});tunnel.on('exit',()=>{clearTimeout(timeout);reject(Error('Tunnel_stopped'));if(!stopping){stop();process.exitCode=1;}});
  });
  await writeFile(new URL('state.json',out),JSON.stringify({manager:process.pid,bridge:bridge.pid,tunnel:tunnel.pid,url,startedAt:new Date().toISOString()},null,2));
  console.log('Web voice bridge: '+url);
  if(config.PHONE_STAFF_SITE_URL){
    let registered=false;
    for(let attempt=0;attempt<5&&!registered;attempt++){try{await registerPhone(url,config);registered=true;}catch{if(attempt<4)await delay(2000);}}
    console.log(registered?'Websites connected to this voice server.':'Endpoint registration pending. After deploying the matching bridge secret, run node scripts/register-phone.mjs.');
  }
}catch(error){stop();throw error;}
