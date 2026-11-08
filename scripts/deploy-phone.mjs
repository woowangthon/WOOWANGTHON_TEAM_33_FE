import {spawn} from 'node:child_process';
import {deploymentSettings} from './vercel-targets.mjs';
import {writeFile,mkdir} from 'node:fs/promises';
const {targets,cli,scope,org}=deploymentSettings();
const mode=process.argv[2];if(!targets[mode])throw new Error('Choose_staff_or_citizen');
await mkdir('outputs/phone-runtime',{recursive:true});
const child=spawn(process.execPath,[cli,'deploy','--prod','--yes','--scope',scope],{windowsHide:true,env:{...process.env,VERCEL_PROJECT_ID:targets[mode],VERCEL_ORG_ID:org},stdio:['ignore','pipe','pipe']});
let output='';const receive=chunk=>{const text=chunk.toString();output+=text;process.stdout.write(text);};child.stdout.on('data',receive);child.stderr.on('data',receive);
const code=await new Promise(resolve=>child.on('exit',resolve));await writeFile('outputs/phone-runtime/deploy-'+mode+'.log',output);process.exitCode=code||0;
