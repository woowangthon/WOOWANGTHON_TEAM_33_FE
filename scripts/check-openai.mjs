// Run with Node 24 --env-file=.env.local. Never emit key or raw provider errors.
const key=process.env.OPENAI_API_KEY||process.env.SERVICE_OPENAI_API_KEY;
if(!key){console.error('OPENAI_API_KEY is missing.');process.exitCode=1;}
else {
  try {
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:process.env.SERVICE_OPENAI_MODEL||'gpt-6-luna',input:'Connection test. Reply OK only.',reasoning:{effort:'none'},max_output_tokens:32,store:false}),
      signal:AbortSignal.timeout(30000),
    });
    const data=await response.json();
    const output=data.output?.filter(item=>item.type==='message').flatMap(item=>item.content||[]).filter(part=>part.type==='output_text').map(part=>part.text).join('').trim();
    const passed=response.ok&&data.status==='completed'&&output==='OK';
    console.log(JSON.stringify({passed,httpStatus:response.status,model:data.model||'gpt-6-luna',status:data.status,errorCode:data.error?.code,errorType:data.error?.type}));
    if(!passed)process.exitCode=1;
  } catch {console.error('OpenAI connection check failed before a valid response was received.');process.exitCode=1;}
}
