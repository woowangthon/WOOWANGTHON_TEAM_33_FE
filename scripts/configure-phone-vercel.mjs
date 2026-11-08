import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {spawn} from 'node:child_process';
import {deploymentSettings} from './vercel-targets.mjs';
const {targets,cli,scope}=deploymentSettings();
const config=parseEnv(await readFile(new URL('../.env.phone.local',import.meta.url),'utf8'));
for(const project of Object.values(targets)){
 for(const key of ['PHONE_BRIDGE_SECRET','PHONE_PROVIDER_TOKEN']){
  if(!config[key])throw new Error('Missing_phone_setting');
  await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,'env','add',key,'--environment','production,preview','--type','secret','--yes','--project',project,'--scope',scope],{stdio:['pipe','ignore','pipe'],windowsHide:true});child.stderr.resume();child.stdin.end(config[key]);child.on('error',()=>reject(new Error('Configuration_start_failed')));child.on('exit',code=>code===0?resolve():reject(new Error('Configuration_failed_'+key)));});
  console.log('Configured '+project+': '+key);
 }
}
