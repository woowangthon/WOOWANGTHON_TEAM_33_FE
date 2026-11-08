import {readFile,writeFile,mkdir,open} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {parseEnv} from 'node:util';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Client} from 'pg';
const root=fileURLToPath(new URL('../',import.meta.url)),out=new URL('../outputs/phone-runtime/',import.meta.url);
await mkdir(out,{recursive:true});
const base=parseEnv(await readFile(new URL('../.env.local',import.meta.url),'utf8'));
let config;try{config=parseEnv(await readFile(new URL('../.env.phone.local',import.meta.url),'utf8'));}catch{config={PHONE_BRIDGE_SECRET:randomBytes(32).toString('hex'),PHONE_PROVIDER_TOKEN:randomBytes(32).toString('hex')};await writeFile(new URL('../.env.phone.local',import.meta.url),Object.entries(config).map(([k,v])=>k+'='+v).join('\n')+'\n');}
if(!base.SERVICE_OPENAI_API_KEY&&!base.OPENAI_API_KEY)throw new Error('Voice_API_key_missing');
if(!config.PHONE_BRIDGE_SECRET)throw new Error('Set_PHONE_BRIDGE_SECRET_in_env_phone_local');
try{const r=await fetch('http://127.0.0.1:4318/health',{signal:AbortSignal.timeout(1500)});if(r.ok){console.log('Phone bridge already running.');process.exit(0);}}catch{}
const tunnelLog=await open(new URL('tunnel.log',out),'w');
const tunnel=spawn(process.env.CLOUDFLARED_PATH||config.CLOUDFLARED_PATH||fileURLToPath(new URL('cloudflared.exe',out)),['tunnel','--no-autoupdate','--url','http://127.0.0.1:4318','--protocol','http2'],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let url,buffer='';
const endpoint=await new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(new Error('Tunnel_start_timeout')),45000);
 const receive=data=>{void tunnelLog.write(data);buffer=(buffer+data.toString()).slice(-16000);const match=buffer.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);if(match){clearTimeout(timer);resolve(match[0]);}};
 tunnel.stdout.on('data',receive);tunnel.stderr.on('data',receive);tunnel.on('error',()=>{clearTimeout(timer);reject(new Error('Tunnel_start_failed'));});tunnel.on('exit',()=>{clearTimeout(timer);reject(new Error('Tunnel_stopped'));});
}).catch(error=>{tunnel.kill();throw error;});
url=String(endpoint);
const connectionUrl=new URL(base.DATABASE_URL_UNPOOLED||base.DATABASE_URL);connectionUrl.searchParams.set('sslmode','verify-full');
const client=new Client({connectionString:connectionUrl.toString()});
try{await client.connect();await client.query(await readFile(new URL('../migrations/008_phone_runtime.sql',import.meta.url),'utf8'));await client.query("INSERT INTO phone_runtime(id,endpoint,updated_at) VALUES('main',$1,NOW()) ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint,updated_at=NOW()",[url]);}catch{tunnel.kill();throw new Error('Phone_runtime_registration_failed');}finally{await client.end();}
const log=await open(new URL('bridge.log',out),'a');
const bridge=spawn(process.execPath,['phone/server.mjs'],{cwd:root,windowsHide:true,env:{...process.env,PHONE_ALLOWED_ORIGINS:config.PHONE_ALLOWED_ORIGINS||[base.CITIZEN_SITE_URL,base.STAFF_SITE_URL].filter(Boolean).join(','),PHONE_BRIDGE_URL:url,PHONE_BRIDGE_SECRET:config.PHONE_BRIDGE_SECRET,PHONE_PROVIDER_TOKEN:config.PHONE_PROVIDER_TOKEN,SERVICE_OPENAI_API_KEY:base.SERVICE_OPENAI_API_KEY||base.OPENAI_API_KEY,SERVICE_OPENAI_MODEL:base.SERVICE_OPENAI_MODEL||'gpt-6-luna'},stdio:['ignore',log.fd,log.fd]});
await log.close();
await writeFile(new URL('state.json',out),JSON.stringify({manager:process.pid,bridge:bridge.pid,tunnel:tunnel.pid,url,startedAt:new Date().toISOString()},null,2));
if(base.STAFF_SITE_URL)await writeFile(new URL('provider-webhook.txt',out),new URL('/api/phone/incoming',base.STAFF_SITE_URL).href+'?token='+encodeURIComponent(config.PHONE_PROVIDER_TOKEN));
console.log('Phone bridge configured: '+url);
const stop=()=>{bridge.kill();tunnel.kill();};process.on('SIGTERM',stop);process.on('SIGINT',stop);
bridge.on('exit',()=>{tunnel.kill();process.exitCode=1;});tunnel.on('exit',()=>{bridge.kill();process.exitCode=1;});
