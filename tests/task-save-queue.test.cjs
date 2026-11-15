const {test}=require('node:test'),assert=require('node:assert/strict');
const load=require('./helpers/loader.cjs')();
const {createTaskSaveQueue}=load('lib/task-save-queue.ts');
const {summarizeHistory}=load('lib/task-history.ts');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const initial=()=>({revision:1,tasks:[{id:'a',label:'현장 확인',done:false},{id:'b',label:'일정 안내',done:false}]});
function harness(){
 let base=initial(),view,reads=0,failed=0;const requests=[],confirmed=[];
 const queue=createTaskSaveQueue(base,{save:snapshot=>new Promise((resolve,reject)=>requests.push({snapshot,resolve,reject})),load:async()=>{reads++;return base;},changed:v=>{view=v;},confirmed:s=>confirmed.push(s),failed:()=>failed++});
 return {queue,requests,confirmed,get view(){return view;},get reads(){return reads;},get failed(){return failed;},remote:s=>{base=s;},resolve:async i=>{const r=requests[i];base={revision:base.revision+1,tasks:r.snapshot.tasks};r.resolve(base);await tick();}};
}
test('checking responds immediately while a deliberately slow save remains pending',async()=>{
 const h=harness();h.queue.set('a',true);assert.equal(h.view.tasks[0].done,true);assert.equal(h.view.saving,true);assert.equal(h.requests.length,1);
 await h.resolve(0);assert.equal(h.view.saving,false);assert.equal(h.reads,0);
});
test('rapid toggles are serialized and coalesced without losing the last choice',async()=>{
 const h=harness();h.queue.set('a',true);h.queue.set('b',true);h.queue.set('a',false);h.queue.set('b',false);h.queue.set('b',true);
 assert.deepEqual(h.view.tasks.map(t=>t.done),[false,true]);assert.equal(h.requests.length,1);
 await h.resolve(0);assert.equal(h.requests.length,2);assert.equal(h.requests[1].snapshot.revision,2);assert.deepEqual(h.requests[1].snapshot.tasks.map(t=>t.done),[false,true]);
 await h.resolve(1);assert.deepEqual(h.view.tasks.map(t=>t.done),[false,true]);assert.equal(h.view.saving,false);assert.equal(h.reads,0);
});
test('a revision conflict merges local changes onto other staff changes before retry',async()=>{
 const h=harness();h.queue.set('a',true);const remote=initial();remote.revision=2;remote.tasks[1].done=true;h.remote(remote);
 h.requests[0].reject(Object.assign(new Error(),{status:409}));await tick();
 assert.equal(h.requests[1].snapshot.revision,2);assert.deepEqual(h.requests[1].snapshot.tasks.map(t=>t.done),[true,true]);
 await h.resolve(1);assert.equal(h.view.error,'');assert.equal(h.reads,1);
});
test('failed saves restore confirmed values and expose a retryable error',async()=>{
 const h=harness();h.queue.set('a',true);h.queue.set('b',true);h.requests[0].reject(new Error('offline'));await tick();
 assert.deepEqual(h.view.tasks.map(t=>t.done),[false,false]);assert.equal(h.view.saving,false);assert.match(h.view.error,/저장하지 못/);assert.equal(h.failed,1);
 h.queue.set('b',true);await h.resolve(1);assert.equal(h.view.error,'');assert.equal(h.view.tasks[1].done,true);
});
test('lost responses reconcile committed changes and stale polls cannot undo them',async()=>{
 const h=harness();h.queue.set('a',true);const committed={revision:2,tasks:h.requests[0].snapshot.tasks};h.remote(committed);h.requests[0].reject(new Error('response lost'));await tick();
 assert.equal(h.view.tasks[0].done,true);h.queue.sync(initial());assert.equal(h.view.tasks[0].done,true);
});
test('old generic history is grouped without inventing which tasks changed',()=>{
 const events=[{id:'1',label:'완료: 현장 확인',created_at:'now'},{id:'2',label:'후속 조치 체크리스트 변경',created_at:'old'},{id:'3',label:'후속 조치 체크리스트 변경',created_at:'older'},{id:'4',label:'홈페이지 민원 접수',created_at:'first'}];
 const result=summarizeHistory(events);assert.equal(result.length,3);assert.equal(result[1].label,'이전 후속 조치 변경 2회');assert.equal(events.length,4);assert.equal(events[1].label,'후속 조치 체크리스트 변경');
});
