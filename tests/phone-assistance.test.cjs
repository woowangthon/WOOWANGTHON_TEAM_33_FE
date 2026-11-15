const test=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/loader.cjs')(),h=load('lib/phone-assistance.ts');
const input={callId:'synthetic-call',revision:'1',segments:[{turnId:'1',text:'소음을 확인하고 처리 일정을 알려 주세요.',facts:[{kind:'request',value:'소음 확인'},{kind:'request',value:'처리 일정 안내'}]}]};
const requests=h.assistanceRequests(input);
const reply={items:requests.map(r=>({requestId:r.id,reply:'현재 자료만으로 일정을 확답하기 어렵습니다.',status:'limited',checks:['실제 처리 일정을 조회해야 합니다.'],references:[]}))};
test('missing or invalid request IDs do not hide valid replies or invent new requests',()=>{
 assert.equal(h.validateAssistance(reply,requests,[]).length,2);
 for(const change of [v=>v.items.pop(),v=>v.items[1].requestId='R1',v=>v.items[1].requestId='R999']){const value=structuredClone(reply);change(value);assert.equal(h.validateAssistance(value,requests,[]).length,1);}
});
test('ungrounded citations exclude only their answer, while ordinary replies do not require internal checklists',()=>{
 const value=structuredClone(reply);value.items[0].references=[{citationId:'law:1',quote:'제공된 공식 근거'}];const citations=[{id:'law:1',text:'이 문장은 제공된 공식 근거입니다.'}];
 assert.equal(h.validateAssistance(value,requests,citations).length,2);
 assert.equal(h.validateAssistance(value,requests,[]).length,1);
 value.items[0].references[0].quote='출처에 없는 약속';assert.equal(h.validateAssistance(value,requests,citations).length,1);
 const noChecks=structuredClone(reply);noChecks.items[0].checks=[];assert.equal(h.validateAssistance(noChecks,requests,[]).length,2);
});
test('non-request facts and duplicate requirements do not make extra generated requests',()=>{
 const duplicate=structuredClone(input);duplicate.segments.push({turnId:'2',text:'같은 요청',facts:[{kind:'request',value:'소음 확인'},{kind:'location',value:'가상공원'}]});assert.deepEqual(h.assistanceRequests(duplicate),requests);
});
test('related law panels accept only exact quotes from supplied official sources',()=>{
 const value={...structuredClone(reply),relatedSources:[{citationId:'law:1',quote:'제공된 처리 원칙'}]};
 const citations=[{id:'law:1',text:'이것은 제공된 처리 원칙입니다.'}];
 assert.equal(h.validateAssistance(value,requests,citations).length,2);
 assert.equal(h.validateAssistance(value,requests,[]).length,2);
 value.relatedSources[0].quote='제공되지 않은 조문';
 assert.equal(h.validateAssistance(value,requests,citations).length,2);
});
test('empty business requests skip paid inference; API calls preserve request IDs and never persist provider history',async()=>{
 const original=global.fetch,calls=[];global.fetch=async(url,options)=>{calls.push(JSON.parse(options.body));return Response.json(url.includes('googleapis')?{status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(reply)}]}]}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(reply)}]}]});};
 try{
  const empty=await h.generateAssistance({...input,segments:[{turnId:'1',text:'업무 요청 없음',facts:[]}]},[],{provider:'openai',key:'test',model:'test'});assert.equal(empty.items.length,0);assert.equal(calls.length,0);
  for(const provider of ['openai','gemini']){const result=await h.generateAssistance(input,[],{provider,key:'test',model:'test'});assert.equal(result.callId,input.callId);assert.equal(result.revision,input.revision);assert.equal(result.items.length,2);assert.equal(calls.at(-1).store,false);}
 }finally{global.fetch=original;}
});
