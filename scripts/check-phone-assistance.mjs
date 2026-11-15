import fs from 'node:fs';
import loader from '../evals/loader.cjs';
const {generateAssistance}=loader()('lib/phone-assistance.ts');
// Opt-in synthetic API smoke. Supply already configured keys through the environment.
const input={callId:'synthetic-latency',revision:'1',segments:[{turnId:'1',text:'위치: 가상공원 입구\n내용: 쓰레기가 쌓여 있음\n요청: 쓰레기 수거 및 처리 일정 안내',facts:[{kind:'location',value:'가상공원 입구'},{kind:'request',value:'쓰레기 수거'},{kind:'request',value:'처리 일정 안내'}]}]};
const configs=[{provider:'openai',key:process.env.SERVICE_OPENAI_API_KEY||process.env.OPENAI_API_KEY,model:'gpt-6-luna'},{provider:'gemini',key:process.env.SERVICE_GEMINI_API_KEY||process.env.GEMINI_API_KEY,model:'gemini-3.5-flash-lite'}].filter(x=>x.key);
if(!configs.length)throw Error('Configure a provider key before running this paid API smoke.');
const reports=await Promise.all(configs.map(async config=>{const start=performance.now();try{return {provider:config.provider,result:await generateAssistance(input,[],config)};}catch(error){process.exitCode=1;return {provider:config.provider,error:error.message,elapsedMs:Math.round(performance.now()-start)};}}));
fs.mkdirSync('outputs',{recursive:true});fs.writeFileSync('outputs/phone-assistance-provider-smoke.json',JSON.stringify({input,reports},null,2));console.log(JSON.stringify(reports.map(r=>({provider:r.provider,elapsedMs:r.result?.elapsedMs||r.elapsedMs,error:r.error,items:r.result?.items})),null,2));
