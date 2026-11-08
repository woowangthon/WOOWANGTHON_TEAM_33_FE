// Build a source-only publication tree. Never copies environment values or runtime output.
import {readFile,readdir,mkdir,writeFile,copyFile,lstat} from 'node:fs/promises';
import {resolve,relative,join,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const destination=resolve(root,process.argv[2]||'outputs/source-upload');
const outputRoot=resolve(root,'outputs')+sep;
if(!destination.startsWith(outputRoot))throw new Error('Destination_must_be_inside_outputs');
const dirs=['app','lib','migrations','phone','public','scripts','tests','workflows','evals','docs'];
const roots=['README.md','AGENTS.md','CLAUDE.md','.gitignore','.vercelignore','.env.example','.env.phone.example','.nvmrc','package.json','package-lock.json','next.config.ts','next-env.d.ts','proxy.ts','tsconfig.json','vercel.json'];
const excluded=new Set(['scripts/port.mjs']); // Obsolete one-time importer of the previous Sites app.
const known=[];
for(const name of ['.env.local','.env.phone.local']){
  let source;try{source=await readFile(join(root,name),'utf8');}catch(error){if(error.code==='ENOENT')continue;throw error;}
  for(const [key,value] of Object.entries(parseEnv(source))){
    if(/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|LAW_API_OC|LAW_OC/i.test(key)&&value.length>=8){known.push(value);try{const u=new URL(value);if(u.password.length>=8)known.push(decodeURIComponent(u.password));}catch{}}
  }
}
const files=[];
async function walk(path){for(const entry of await readdir(join(root,path),{withFileTypes:true})){
  const name=path+'/'+entry.name;
  if(entry.isSymbolicLink())throw new Error('Symlink_not_allowed_'+name);
  if(entry.isDirectory()){if(name!=='app/.well-known/workflow'&&!['node_modules','.git','.next','outputs','.cache'].includes(entry.name))await walk(name);}
  else if(!excluded.has(name))files.push(name);
}}
for(const dir of dirs)await walk(dir);files.push(...roots);
const findings=[],manifest=[];
const patterns=[['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],['openai-key',/sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/],['google-key',/AIza[0-9A-Za-z_-]{30,}/],['github-token',/(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/],['db-password',/postgres(?:ql)?:\/\/[^\s:]+:[^\s@]+@/]];
for(const file of files.sort()){
  if(/(?:^|\/)\.env(?!\.(?:phone\.)?example$)|\.(?:exe|dll|lnk|log|pem|key|p12|sqlite|db|zip|tar\.gz)$/i.test(file))findings.push({file,reason:'excluded-file-type'});
  const data=await readFile(join(root,file));
  if(data.length>25*1024*1024)findings.push({file,reason:'file-too-large'});
  for(const value of known)if(data.includes(Buffer.from(value)))findings.push({file,reason:'matches-local-secret'});
  if(!/\.(?:png|jpe?g|wav|webp|ico|woff2?)$/i.test(file))for(const [reason,re] of patterns)if(re.test(data.toString('utf8')))findings.push({file,reason});
  manifest.push({file,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')});
}
if(findings.length){console.error(JSON.stringify({status:'blocked',findings},null,2));process.exitCode=1;}
else {
  let existing=false;try{await lstat(destination);existing=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(existing)throw new Error('Use_a_new_destination_to_avoid_stale_files');
  await mkdir(destination,{recursive:true});
  for(const {file} of manifest){await mkdir(resolve(destination,file,'..'),{recursive:true});await copyFile(join(root,file),join(destination,file));}
  const report={status:'passed',files:manifest.length,bytes:manifest.reduce((n,x)=>n+x.bytes,0),excluded:['all private .env files','outputs/','node_modules/','.next/','.vercel/','.agents/','generated app/.well-known/workflow/','local shortcuts','scripts/port.mjs'],destination:relative(root,destination).replaceAll('\\','/'),manifest};
  await writeFile(join(root,'outputs/source-publication-manifest.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:report.status,files:report.files,bytes:report.bytes,destination:report.destination}));
}
