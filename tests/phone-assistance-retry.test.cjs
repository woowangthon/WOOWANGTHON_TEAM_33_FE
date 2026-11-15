const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
const load=require('./helpers/loader.cjs')();
const answer=id=>({requestId:id,request:id,reply:'안내 '+id,status:'guidance',checks:[],references:[]});
const result=(items,pending=[])=>({callId:'call',revision:'1',inputHash:'same',items:items.map(answer),pendingRequestIds:pending,citations:[],relatedSources:[],warnings:[]});

test('automatic retries show partial replies, fill missing replies, and stop after success or unmount',async()=>{
  const cells=[],effects=[],timers=[];let cursor=0,fetches=0;
  const hooks={
    useState(initial){const i=cursor++;if(!(i in cells))cells[i]=initial;return[cells[i],value=>{cells[i]=typeof value==='function'?value(cells[i]):value;}];},
    useRef(initial){const i=cursor++;return cells[i]??={current:initial};},
    useEffect(callback,deps){const i=cursor++,old=cells[i];if(!old||deps.some((v,n)=>v!==old.deps[n])){old?.cleanup?.();cells[i]={deps};effects.push(()=>{cells[i].cleanup=callback();});}},
  };
  const source=fs.readFileSync('app/phone-assistance.tsx','utf8'),cut=source.indexOf(' return <aside');
  const code=ts.transpileModule(source.slice(0,cut)+' return {result,busy,error};\n}',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const out={},fetcher=async(url,options)=>{fetches++;const request=JSON.parse(options.body);return{ok:fetches>1,json:async()=>fetches===1?{error:'temporary'}:{...(fetches===2?result(['R1'],['R2']):result(['R2'],['R1'])),revision:request.revision}};};
  new Function('require','exports','fetch','setTimeout','clearTimeout',code)(name=>name==='react'?hooks:name.includes('phone-assistance-result')?load('lib/phone-assistance-result.ts'):{},out,fetcher,(fn,delay)=>{const t={fn,delay,active:true};timers.push(t);return t;},t=>{if(t)t.active=false;});
  const segments=[{turnId:'t',text:'두 가지 요청',facts:[{kind:'request',value:'R1'},{kind:'request',value:'R2'}]}];
  const render=()=>{cursor=0;const value=out.default({callId:'call',segments});while(effects.length)effects.shift()();return value;};
  const tick=async()=>{const timer=timers.find(t=>t.active);assert.ok(timer,'scheduled task exists');timer.active=false;await timer.fn();await new Promise(resolve=>setImmediate(resolve));return render();};
  render();let view=await tick();assert.equal(fetches,1);assert.match(view.error,/준비/);
  await tick();view=await tick();assert.equal(fetches,2);assert.deepEqual(view.result.items.map(i=>i.requestId),['R1']);
  await tick();view=await tick();assert.equal(fetches,3);assert.deepEqual(view.result.items.map(i=>i.requestId),['R1','R2']);assert.deepEqual(view.result.pendingRequestIds,[]);assert.equal(timers.some(t=>t.active),false);
  for(const cell of cells)cell?.cleanup?.();assert.equal(timers.some(t=>t.active),false);
});

test('a changed transcript or different call never inherits answers from an older attempt',()=>{
  const {mergeAssistance}=load('lib/phone-assistance-result.ts');
  assert.deepEqual(mergeAssistance(result(['R1']),{...result(['R2']),inputHash:'changed'}).items.map(i=>i.requestId),['R2']);
  assert.deepEqual(mergeAssistance(result(['R1']),{...result(['R2']),callId:'other'}).items.map(i=>i.requestId),['R2']);
});
