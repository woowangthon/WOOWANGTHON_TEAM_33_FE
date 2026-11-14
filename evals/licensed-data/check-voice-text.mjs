// Text branch of the current phone pipeline only. No microphone, STT or live call.
import {readFile,writeFile,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {TextPipeline} from '../../phone/text-pipeline.mjs';
if(!process.argv.includes('--live'))throw Error('Live API check requires --live');
const key=process.env.SERVICE_OPENAI_API_KEY||process.env.OPENAI_API_KEY;if(!key)throw Error('Existing OpenAI key unavailable');
const folder=resolve(process.env.LICENSED_DATA_DIR||'../licensed-data'),file=resolve(folder,'voice-text-check.json');
try{await access(file);throw Error('Preserve the existing result before another paid run');}catch(e){if(e.code!=='ENOENT')throw e;}
const data=JSON.parse(await readFile(resolve(folder,'voice-text-samples.json'),'utf8'));
if(data.source.license!=='MIT'||data.synthetic!==false||data.actualComplaints!==false)throw Error('Licensed text provenance missing');
const report={startedAt:new Date().toISOString(),model:process.env.SERVICE_OPENAI_MODEL||'gpt-6-luna',source:data.source,synthetic:false,actualComplaints:false,actualCall:false,method:data.method,pipelineSha256:createHash('sha256').update(await readFile(new URL('../../phone/text-pipeline.mjs',import.meta.url))).digest('hex'),results:[]};
const save=()=>writeFile(file,JSON.stringify(report,null,2));await save();
const pipeline=new TextPipeline({apiKey:key,model:report.model});
for(const sample of data.samples){
 const row={id:sample.id,sourceLine:sample.sourceLine,text:sample.text,reference:sample.reference,status:'inflight'};report.results.push(row);await save();
 try{row.decision=await pipeline.checkSafety(sample.text);row.status='completed';row.matchesReference=row.decision.directAbuse===sample.reference.directAbuse;row.usage=pipeline.usage.at(-1);}
 catch(e){row.status='error_or_unknown';row.error=e.message;await save();throw e;}
 await save();
}
report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({cases:report.results.length,matches:report.results.filter(r=>r.matchesReference).length,apiCalls:pipeline.usage.length,microphoneTested:false}));
