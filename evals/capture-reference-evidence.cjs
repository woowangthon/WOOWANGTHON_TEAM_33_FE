// Optional diagnostic preload: stores synthetic reference output, never HTTP headers or keys.
const fs=require('node:fs'),crypto=require('node:crypto'),network=global.fetch;
const output=process.env.REFERENCE_EVIDENCE_OUT;
if(!output)throw Error('Set REFERENCE_EVIDENCE_OUT for synthetic evaluation diagnostics');
global.fetch=async(...args)=>{
  const response=await network(...args);
  let body;try{body=JSON.parse(args[1]?.body||'{}');}catch{return response;}
  if(body.text?.format?.name!=='requirements_reference_grading'||!response.ok)return response;
  const data=await response.clone().json(),text=(data.output||[]).filter(p=>p.type==='message').flatMap(p=>p.content||[]).filter(p=>p.type==='output_text').map(p=>p.text).join('');
  let input,grade;try{input=JSON.parse(body.input);grade=JSON.parse(text);}catch{return response;}
  const record={at:new Date().toISOString(),title:input.source?.title,draftSha256:crypto.createHash('sha256').update(input.draft).digest('hex'),grade,invalidQuoteIds:(grade.checks||[]).filter(c=>c.replyQuote&&!input.draft.includes(c.replyQuote)).map(c=>c.id)};
  fs.appendFileSync(output,JSON.stringify(record)+'\n');return response;
};
