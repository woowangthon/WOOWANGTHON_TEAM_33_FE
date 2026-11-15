const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/loader.cjs')(),{phoneAssistanceContext}=load('lib/phone-assistance-context.ts'),h=load('lib/phone-assistance.ts');
const call=(id,callerId,day,status='ended')=>({id,callerId,status,startedAt:`2026-11-${day}T01:00:00Z`,segments:[{text:id+' 업무 내용'}],messages:[{speaker:'staff',text:id+' 안내',at:`2026-11-${day}T01:01:00Z`}]});

test('assistance includes only older ended consultations for the same caller and includes staff answers',()=>{
  const rows=[call('current','a',15,'active'),call('old','a',14),call('stranger','b',13),call('future','a',16),call('waiting','a',12,'waiting')];
  const context=phoneAssistanceContext(rows,'current');
  assert.deepEqual(context.priorCalls.map(c=>c.callId),['old']);assert.equal(context.conversation[0].speaker,'staff');assert.match(context.priorCalls[0].transcript,/담당자: old 안내/);
  assert.deepEqual(phoneAssistanceContext([{...rows[0],callerId:undefined},rows[1]],'current').priorCalls,[]);
  assert.deepEqual(phoneAssistanceContext(rows,'old').priorCalls,[],'browsing an old call must not include its future');
});

test('large history is bounded and explicitly marked as an excerpt',()=>{
  const old=call('old','a',14);old.messages[0].text='긴 기록 '.repeat(5000);
  const context=phoneAssistanceContext([call('current','a',15),old],'current');
  assert.equal(context.priorCalls[0].transcript.length,6000);assert.equal(context.priorCalls[0].excerpted,true);
});

test('both model providers receive conversation and prior context, while request IDs remain current-only',async()=>{
  const previous=global.fetch,bodies=[];
  const context=phoneAssistanceContext([call('current','a',15),call('old','a',14)],'current');
  const input=h.assistanceInput.parse({callId:'current',revision:'1',segments:[{turnId:'t',text:'현재 요청',facts:[{kind:'request',value:'진행 현황 확인'}]}],...context});
  const result={items:[{requestId:'R1',reply:'진행 현황을 확인하겠습니다.',status:'limited',checks:['실제 조치 현황 조회'],references:[]}],relatedSources:[]};
  global.fetch=async(url,options)=>{bodies.push(JSON.parse(options.body));return Response.json(url.includes('googleapis')?{status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(result)}]}]}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(result)}]}]});};
  try{for(const provider of ['openai','gemini']){
    await h.generateAssistance(input,[],{provider,key:'test',model:'test'});
    const payload=JSON.parse(bodies.at(-1).input);assert.equal(payload.currentConversation[0].speaker,'staff');assert.equal(payload.transcript,'담당자: current 안내');assert.equal(payload.previousConsultations[0].callId,'old');assert.deepEqual(payload.requests,[{id:'R1',text:'진행 현황 확인'}]);
  }}finally{global.fetch=previous;}
});
