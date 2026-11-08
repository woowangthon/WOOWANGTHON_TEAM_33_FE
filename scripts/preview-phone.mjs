import {readFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {spawn} from 'node:child_process';
const base=parseEnv(await readFile('.env.local','utf8'));
const phone=parseEnv(await readFile('.env.phone.local','utf8'));
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','3100'],{env:{...process.env,...base,...phone,SITE_MODE:'staff'},stdio:'inherit',windowsHide:true});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill());
child.on('exit',code=>{process.exitCode=code||0;});
