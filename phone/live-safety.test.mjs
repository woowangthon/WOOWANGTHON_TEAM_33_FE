import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as settle} from 'node:timers/promises';
import {LiveSafety} from './live-safety.mjs';
const normal={directAbuse:false,scope:'normal',category:'none',evidence:''};
const defer=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function setup(t,check=async()=>normal){
  t.mock.timers.enable({apis:['setTimeout']});
  let at=0;const calls=[],results=[],errors=[];
  const guard=new LiveSafety({now:()=>at,check:(text,options)=>{calls.push({text,options,at});return check(text,options);},onResult:(turn,result,text)=>results.push({turn,result,text}),onError:()=>errors.push('error')});
  t.after(()=>guard.close());
  return {guard,calls,results,errors,advance:async ms=>{at+=ms;t.mock.timers.tick(ms);await settle();}};
}
test('every nonempty partial is eligible immediately, including words outside any profanity list',async t=>{
  const {guard,calls,advance}=setup(t);
  for(const text of ['도와주세요','문제의 시발점','네 가족을 가만두지 않겠다']){
    guard.enqueue({partial:text});await settle();assert.equal(calls.at(-1).text,text);await advance(1200);
  }
  assert.equal(calls.length,3);assert.ok(calls.every(c=>c.options.partial));
});
test('blank and repeated deltas do not create duplicate calls',async t=>{
  const {guard,calls,advance}=setup(t),turn={partial:'  '};guard.enqueue(turn);await settle();assert.equal(calls.length,0);
  turn.partial='요청';guard.enqueue(turn);await settle();guard.enqueue(turn);await advance(5000);assert.equal(calls.length,1);
});
test('one in-flight request coalesces all arriving deltas and respects the start interval',async t=>{
  const pending=defer();const {guard,calls,advance}=setup(t,()=>pending.promise),turn={partial:'처음'};
  guard.enqueue(turn);await settle();
  for(const text of ['두 번째','최신 문맥']){turn.partial=text;guard.enqueue(turn);}
  await advance(400);assert.equal(calls.length,1);
  pending.resolve(normal);await settle();await advance(799);assert.equal(calls.length,1);
  await advance(1);assert.equal(calls.length,2);assert.equal(calls[1].text,'최신 문맥');
});
test('long speech remains checked after the first three requests',async t=>{
  const {guard,calls,advance}=setup(t),turn={partial:''};
  for(let i=0;i<6;i++){turn.partial+=' 새 내용';guard.enqueue(turn);await settle();await advance(1200);}
  assert.equal(calls.length,6);
});
test('partial results stay attached to their own turn and queued turns are not overwritten',async t=>{
  const pending=defer();let first=true;
  const {guard,calls,results,advance}=setup(t,()=>{if(first){first=false;return pending.promise;}return normal;});
  const a={partial:'첫 발화'},b={partial:'다음 발화'};guard.enqueue(a);await settle();guard.enqueue(b);
  pending.resolve(normal);await settle();await advance(1200);
  assert.equal(calls[1].text,b.partial);assert.equal(results[0].turn,a);assert.equal(results[1].turn,b);
});
test('final review cancels obsolete partials, including a late positive response',async t=>{
  const pending=defer();const {guard,calls,results,advance}=setup(t,()=>pending.promise),turn={partial:'이전 문맥'};
  guard.enqueue(turn);await settle();turn.partial='이전 문맥의 피해 신고';guard.enqueue(turn);guard.finish(turn);
  assert.equal(calls[0].options.signal.aborted,true);
  pending.resolve({...normal,directAbuse:true});await settle();await advance(5000);assert.equal(results.length,0);assert.equal(calls.length,1);
});
test('closing a call aborts pending work and ignores late results/errors',async t=>{
  const pending=defer();const {guard,calls,results,errors,advance}=setup(t,()=>pending.promise),turn={partial:'발화'};
  guard.enqueue(turn);await settle();turn.partial+=' 추가';guard.enqueue(turn);guard.close();pending.reject(Error('late'));
  await settle();await advance(5000);assert.ok(calls[0].options.signal.aborted);assert.equal(calls.length,1);assert.equal(results.length,0);assert.equal(errors.length,0);
});
test('a failed partial does not prevent checking later new context',async t=>{
  let fail=true;const {guard,calls,errors,results,advance}=setup(t,async()=>{if(fail){fail=false;throw Error('network');}return normal;});
  const turn={partial:'처음'};guard.enqueue(turn);await settle();turn.partial+=' 추가';guard.enqueue(turn);await advance(1200);
  assert.equal(calls.length,2);assert.equal(errors.length,1);assert.equal(results.length,1);
});

test('a positive for text removed by a new ASR hypothesis cannot trigger protection',async t=>{
 const pending=defer(),{guard,results}=setup(t,()=>pending.promise),turn={partial:'이전 공격 발췌'};guard.enqueue(turn);await settle();turn.partial='정정된 제3자 피해 신고';guard.enqueue(turn);pending.resolve({directAbuse:true,evidence:'이전 공격 발췌'});await settle();assert.equal(results.length,0);
});

test('429 respects provider retry delay, coalesces the latest text, and never starts a request storm',async t=>{
 let first=true;const {guard,calls,errors,advance}=setup(t,async()=>{if(first){first=false;throw Object.assign(Error('Gemini_HTTP_429'),{retryAfterMs:10000});}return normal;});
 const turn={partial:'첫 문맥'};guard.enqueue(turn);await settle();turn.partial='최신 문맥';guard.enqueue(turn);await advance(9999);assert.equal(calls.length,1);assert.equal(errors.length,1);await advance(1);assert.equal(calls.length,2);assert.equal(calls[1].text,'최신 문맥');
});
