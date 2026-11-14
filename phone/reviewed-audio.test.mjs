import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ReviewedAudio} from './reviewed-audio.mjs';
import {FilterRelay} from './filter-relay.mjs';
const frame=n=>Buffer.alloc(160,n).toString('base64');
test('unreviewed audio never becomes audible just because time passes',async t=>{
 const heard=[],gate=new ReviewedAudio({onFrame:x=>heard.push(x)});t.after(()=>gate.close());
 gate.push(frame(1));gate.declare('turn',{startMs:0,endMs:20});await delay(70);assert.deepEqual(heard,[]);
 gate.settle('turn',true);await delay(45);assert.deepEqual(heard,[frame(1)]);
});
test('out-of-order AI responses preserve audio order and reject uncovered boundary frames',async t=>{
 const heard=[],gate=new ReviewedAudio({onFrame:x=>heard.push(x)});t.after(()=>gate.close());
 for(let n=0;n<5;n++)gate.push(frame(n));
 gate.declare('a',{startMs:5,endMs:45});gate.declare('b',{startMs:60,endMs:100});
 gate.settle('b',true);await delay(35);assert.deepEqual(heard,[]);
 gate.settle('a',true);await delay(100);assert.deepEqual(heard,[frame(1),frame(3),frame(4)]);
});
test('rejected/uncertain audio and a later pending tail are never released',async t=>{
 const heard=[],gate=new ReviewedAudio({onFrame:x=>heard.push(x)});t.after(()=>gate.close());
 for(let n=0;n<4;n++)gate.push(frame(n));gate.declare('attack',{startMs:0,endMs:40});gate.settle('attack',false);
 await delay(80);assert.deepEqual(heard,[]);assert.equal(gate.frames.length,2);
});
test('invalid ranges and overflow fail closed without releasing old audio',async t=>{
 let errors=0;const heard=[],gate=new ReviewedAudio({onFrame:x=>heard.push(x),onError:()=>errors++,maxBufferedMs:40});t.after(()=>gate.close());
 gate.push(frame(0));gate.declare('bad',{startMs:0,endMs:80});assert.equal(errors,1);
 for(let n=0;n<3;n++)gate.push(frame(0));assert.equal(errors,2);await delay(40);assert.deepEqual(heard,[]);
});
test('protection clears already approved playback; officer audio and analysis continue',async t=>{
 const caller=[],officer=[],seen=[];const relay=new FilterRelay({reviewed:true,caller:e=>caller.push(e),officer:e=>officer.push(e),onCallerAudio:p=>seen.push(p)});t.after(()=>relay.end());relay.start('call');
 relay.fromCaller(frame(1));relay.audioBoundary('a',{startMs:0,endMs:20});relay.audioReviewed('a',true);
 relay.protectManually('manual','보호');relay.fromOfficer(frame(2));relay.fromCaller(frame(3));await delay(50);
 assert.equal(officer.filter(e=>e.event==='media').length,0);assert.equal(caller.length,1);assert.equal(seen.length,2);
 relay.resume();relay.fromCaller(frame(4));relay.audioBoundary('b',{startMs:40,endMs:60});relay.audioReviewed('b',true);await delay(40);
 assert.deepEqual(officer.filter(e=>e.event==='media').map(e=>e.payload),[frame(4)]);
});
