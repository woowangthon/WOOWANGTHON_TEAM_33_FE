import {spawn} from 'node:child_process';
import {readFile,appendFile} from 'node:fs/promises';
import {deploymentSettings} from './vercel-targets.mjs';
const {cli,scope,targets:projectIds}=deploymentSettings();
const common={APP_SECRET:process.env.APP_SECRET,NEON_AUTH_COOKIE_SECRET:process.env.NEON_AUTH_COOKIE_SECRET,STAFF_EMAILS:process.env.STAFF_EMAILS,STAFF_SITE_URL:process.env.STAFF_SITE_URL,CITIZEN_SITE_URL:process.env.CITIZEN_SITE_URL};
const targets=Object.entries(projectIds).map(([mode,id])=>({mode,id}));
for(const target of targets){
 const env={...common,SITE_MODE:target.mode,...(target.mode==='staff'?{DATABASE_URL:process.env.DATABASE_URL,NEON_AUTH_BASE_URL:process.env.NEON_AUTH_BASE_URL}:{})};
 for(const [key,value] of Object.entries(env)){
  if(!value)throw new Error('Missing required setting: '+key);
  const type=['SITE_MODE','STAFF_SITE_URL','CITIZEN_SITE_URL','NEON_AUTH_BASE_URL'].includes(key)?'config':'secret';
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,'env','add',key,'--environment','production,preview','--type',type,'--yes','--project',target.id,'--scope',scope],{stdio:['pipe','pipe','pipe'],windowsHide:true});
   let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.stdin.end(value);
   child.on('error',()=>reject(new Error('Unable to start environment setup')));child.on('exit',code=>code===0?resolve():reject(new Error(`Environment setup failed for ${target.mode}/${key}; CLI exit ${code}`)));
  });console.log(`Configured ${target.mode}: ${key}`);
 }
}
const local=await readFile('.env.local','utf8');for(const key of ['STAFF_SITE_URL','CITIZEN_SITE_URL'])if(!local.includes(key+'='))await appendFile('.env.local',`\n${key}=${JSON.stringify(common[key])}\n`);
