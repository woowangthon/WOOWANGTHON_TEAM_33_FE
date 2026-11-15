const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),ts=require('typescript');

// Run the actual desk handlers with browser devices and sockets replaced by fakes.
// Omit only JSX rendering so these regressions do not depend on a real microphone.
function desk(){
  const cells=[],effects=[],intervals=[],sockets=[],tracks=[],nodes=[],requests=[],saved=new Map();let cursor=0;
  const hooks={
    useState(initial){const i=cursor++;if(!(i in cells))cells[i]=initial;return[cells[i],value=>{cells[i]=typeof value==='function'?value(cells[i]):value;}];},
    useRef(initial){const i=cursor++;return cells[i]??=( {current:initial} );},
    useEffect(callback){const i=cursor++;if(!(i in cells)){cells[i]=true;effects.push(callback);}},
  };
  class Context{
    constructor(){this.state='running';this.destination={};this.audioWorklet={addModule:async()=>{}};}
    async resume(){this.state='running';}async close(){this.state='closed';}async setSinkId(id){this.sinkId=id;}
    createMediaStreamSource(stream){return{stream,connect(){},disconnect(){}};}
  }
  class Worklet{constructor(){this.port={postMessage(){},onmessage:null};nodes.push(this);}connect(){}disconnect(){}}
  class Socket{
    static OPEN=1;constructor(){this.readyState=0;this.bufferedAmount=0;this.sent=[];sockets.push(this);}
    send(value){this.sent.push(JSON.parse(value));}close(){this.readyState=3;this.onclose?.();}
    open(){this.readyState=1;this.onopen();}event(value){this.onmessage({data:JSON.stringify(value)});}
  }
  const mediaDevices={
    async getUserMedia(options){requests.push(options);const track={readyState:'live',label:'Selected headset',stops:0,getSettings:()=>({deviceId:options.audio.deviceId?.exact||'working-headset'}),stop(){this.stops++;this.readyState='ended';}};tracks.push(track);return{getTracks:()=>[track],getAudioTracks:()=>[track]};},
    async enumerateDevices(){return[{kind:'audioinput',deviceId:'working-headset',label:'Selected headset'},{kind:'audiooutput',deviceId:'speaker'}];},
    addEventListener(){},removeEventListener(){},
  };
  let history=[];
  const fetcher=async(url,options)=>({ok:true,json:async()=>options?.method==='POST'?{role:'staff',url:'wss://test.local'}:url.includes('history')?{calls:history}:{online:true,available:true}});
  const source=fs.readFileSync('app/phone-desk.tsx','utf8');
  const cut=source.indexOf('  return <section className=');assert.ok(cut>0);
  const code=ts.transpileModule(source.slice(0,cut)+'  return {checkMicrophone,chooseMicrophone,connect,accept,state,calls,waitingCall,receivingRequested,toggleArchive,archiveMode,displayCalls,selected,setSelected,message,historyLoading,historyError};\n}',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const out={},load=require('./helpers/loader.cjs')();
  new Function('require','exports','AudioContext','AudioWorkletNode','WebSocket','navigator','window','localStorage','fetch','setInterval','clearInterval',code)(name=>{
    if(name==='react')return hooks;if(name.includes('phone-history-scope'))return load('lib/phone-history-scope.ts');if(name.includes('phone-notice'))return load('lib/phone-notice.ts');if(name.includes('phone-assistance-context'))return load('lib/phone-assistance-context.ts');return{};
  },out,Context,Worklet,Socket,{mediaDevices},{},{getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)},fetcher,fn=>{intervals.push(fn);return intervals.length;},()=>{});
  const render=()=>{cursor=0;return out.default({staff:true});};
  return{render,effects,intervals,sockets,tracks,nodes,requests,saved,setHistory:rows=>{history=rows;}};
}
const waiting=id=>({id,callerId:'caller',callerName:'Caller',status:'waiting',source:'browser',startedAt:new Date().toISOString(),messages:[],segments:[]});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('a checked microphone is reused for reception and two successive calls without reopening or stopping it',async()=>{
  const d=desk();await d.render().checkMicrophone();assert.equal(d.requests.length,1);
  await d.render().connect();const ws=d.sockets[0];ws.open();ws.event({event:'ready'});
  for(const id of ['first','second']){
    ws.event({event:'calls',calls:[waiting(id)]});await d.render().accept();
    assert.equal(ws.sent.at(-1).event,'accept');assert.equal(ws.sent.at(-1).callId,id);
    ws.event({event:'active',callId:id});
    if(id==='second'){ws.event({event:'ended',callId:'first'});assert.equal(d.render().state,'active','a delayed end from the previous call cannot end the next call');}
    d.nodes[0].port.onmessage({data:{type:'frame',format:'pcm16-16000',frame:new Uint8Array(640).fill(12).buffer}});
    assert.equal(ws.sent.at(-1).event,'media');assert.equal(ws.sent.at(-1).callId,id);
    assert.ok(Buffer.from(ws.sent.at(-1).payload,'base64').some(byte=>byte===12));
    ws.event({event:'ended',callId:id});assert.equal(d.render().state,'ended');const sent=ws.sent.length;d.nodes[0].port.onmessage({data:{type:'frame',format:'pcm16-16000',frame:new Uint8Array(640).buffer}});assert.equal(ws.sent.length,sent,'remote hangup stops outgoing audio');
    assert.equal(d.tracks[0].stops,0,'ending a staff call must not tear down the working headset');
    await d.render().checkMicrophone();assert.equal(d.requests.length,1,'checking while listening reuses the same input');
  }
  assert.equal(d.requests.length,1,'no new device selection on accept or second call');
});

test('the exact selected microphone is used, without silently falling back to a different device',async()=>{
  const d=desk();await d.render().chooseMicrophone('qc45-selected');await d.render().connect();
  const ws=d.sockets[0];ws.open();ws.event({event:'ready'});ws.event({event:'calls',calls:[waiting('call')]});await d.render().accept();
  assert.deepEqual(d.requests[0].audio.deviceId,{exact:'qc45-selected'});assert.equal(d.saved.get('minwonsai-audio-microphone'),'qc45-selected');
  ws.event({event:'ended',callId:'call'});
});

test('a missed incoming socket notification is recovered by reception synchronization',async()=>{
  const d=desk();const api=d.render();api.receivingRequested.current=true;await api.connect();
  const ws=d.sockets[0];ws.open();ws.event({event:'ready'});
  d.setHistory([waiting('recovered')]);const cleanup=d.effects[1]();await flush();await flush();
  assert.equal(d.render().waitingCall.id,'recovered');await d.render().accept();assert.equal(ws.sent.at(-1).callId,'recovered');
  cleanup();
});

test('a missed hangup does not leave the next incoming call hidden behind active state',async()=>{
  const d=desk();const api=d.render();api.receivingRequested.current=true;await api.connect();
  const ws=d.sockets[0];ws.open();ws.event({event:'ready'});ws.event({event:'calls',calls:[waiting('old')]});await d.render().accept();ws.event({event:'active',callId:'old'});
  d.setHistory([{...waiting('old'),status:'ended'},waiting('next')]);const cleanup=d.effects[1]();await flush();await flush();
  assert.equal(d.render().state,'ready');assert.equal(d.render().waitingCall.id,'next');await d.render().accept();assert.equal(ws.sent.at(-1).callId,'next');
  assert.equal(d.requests.length,1);cleanup();
});

test('ended conversations can be opened without a microphone or reception socket',async()=>{
  const d=desk();const old={...waiting('old'),status:'ended',messages:[{id:'m',speaker:'caller',text:'가로등을 수리해 주세요.',at:new Date().toISOString()}]};
  d.setHistory([old,{...waiting('other'),callerId:'other',status:'ended'}]);
  assert.equal(d.render().displayCalls.length,0);await d.render().toggleArchive();
  assert.equal(d.render().archiveMode,true);assert.equal(d.render().displayCalls.length,2);
  d.render().setSelected('old');const view=d.render();assert.equal(view.selected,'old');assert.equal(view.displayCalls.find(c=>c.id===view.selected).messages[0].text,'가로등을 수리해 주세요.');
  assert.equal(d.requests.length,0);assert.equal(d.sockets.length,0);
  await d.render().toggleArchive();assert.equal(d.render().displayCalls.length,0);
});

test('a new incoming call replaces the archive with only its callers history',async()=>{
  const d=desk();d.setHistory([{...waiting('old'),status:'ended'},{...waiting('other-old'),callerId:'other',status:'ended'}]);
  await d.render().toggleArchive();await d.render().connect();const ws=d.sockets[0];ws.open();ws.event({event:'ready'});
  ws.event({event:'calls',calls:[waiting('new'),{...waiting('old'),status:'ended'},{...waiting('other-old'),callerId:'other',status:'ended'}]});
  const view=d.render();assert.equal(view.archiveMode,false);assert.equal(view.selected,'new');assert.deepEqual(view.displayCalls.map(c=>c.id),['new','old']);
  ws.event({event:'ended',callId:'new'});
});

test('post-call transcription warnings are ignored and cannot overwrite a subsequent call',async()=>{
  const d=desk();await d.render().connect();const ws=d.sockets[0];ws.open();ws.event({event:'ready'});
  ws.event({event:'calls',calls:[waiting('first')]});await d.render().accept();ws.event({event:'active',callId:'first'});
  ws.event({event:'analysis_error',callId:'first',message:'현재 통화 연결 확인'});assert.equal(d.render().message,'현재 통화 연결 확인');
  ws.event({event:'ended',callId:'first'});ws.event({event:'analysis_error',callId:'first',message:'통화 마지막 발화를 확인해야 합니다.'});assert.equal(d.render().message,'');
  ws.event({event:'calls',calls:[waiting('next')]});await d.render().accept();ws.event({event:'active',callId:'next'});
  ws.event({event:'analysis_error',callId:'first',message:'통화 마지막 발화를 확인해야 합니다.'});assert.equal(d.render().message,'');assert.equal(d.render().state,'active');
  ws.event({event:'ended',callId:'next'});
});
