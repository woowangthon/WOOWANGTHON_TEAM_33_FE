const fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),crypto=require('node:crypto');
class AppError extends Error{constructor(message,status=400,retryable=true){super(message);this.status=status;this.retryable=retryable;}}
function loader(){const cache=new Map();return function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);if(file.endsWith('.json'))return JSON.parse(fs.readFileSync(file,'utf8'));const out={};cache.set(file,out);new Function('require','exports',ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText)(name=>name==='./server'?{AppError,now:()=>new Date().toISOString(),database:()=>{throw Error('Unit test DB disabled');}}:name.startsWith('.')?load(path.resolve(path.dirname(file),name+(name.endsWith('.json')?'':'.ts'))):require(name),out);return out;};}

module.exports=loader;
