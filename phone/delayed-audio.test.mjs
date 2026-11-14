import test from 'node:test';
import assert from 'node:assert/strict';
import {FilterRelay} from './filter-relay.mjs';
import {DelayedAudio} from './delayed-audio.mjs';
function setup(t){
 t.mock.timers.enable({apis:['setTimeout']});const caller=[],officer=[],analysis=[];let now=0;
 const relay=new FilterRelay({delayMs:2500,now:()=>now,caller:e=>caller.push(e),officer:e=>officer.push(e),onCallerAudio:frame=>analysis.push(frame)});relay.start('test');t.after(()=>relay.end());
 return {relay,caller,officer,analysis,tick:ms=>{now+=ms;t.mock.timers.tick(ms);}};
}
test('AI sees caller audio immediately; only caller playback waits, preserving frame order',t=>{
 const {relay,caller,officer,analysis,tick}=setup(t);relay.fromCaller('one');tick(20);relay.fromCaller('two');relay.fromOfficer('reply');
 assert.deepEqual(analysis,['one','two']);assert.equal(officer.length,0);assert.equal(caller[0].media.payload,'reply');
 tick(2480);assert.deepEqual(officer.map(e=>e.payload),['one']);tick(20);assert.deepEqual(officer.map(e=>e.payload),['one','two']);
});
test('protection clears delayed speech; resuming cannot replay any blocked frames',t=>{
 const {relay,officer,tick}=setup(t);relay.fromCaller('pending attack');tick(1000);
 relay.enableShield({category:'threat',protectiveTakeoverRecommended:true,evidence:'해치겠다'},'너를 해치겠다');tick(5000);
 assert.equal(officer.filter(e=>e.event==='media').length,0);relay.fromCaller('blocked');relay.resume();relay.fromCaller('new speech');tick(2499);
 assert.equal(officer.filter(e=>e.event==='media').length,0);tick(1);assert.deepEqual(officer.filter(e=>e.event==='media').map(e=>e.payload),['new speech']);
});
test('manual protection, errors and hangup discard queued audio and stop all timers',t=>{
 const {relay,officer,tick}=setup(t);relay.fromCaller('one');relay.protectManually('analysis_error','offline');tick(3000);assert.equal(officer.filter(e=>e.event==='media').length,0);
 relay.resume();relay.fromCaller('two');relay.end();tick(3000);assert.equal(officer.filter(e=>e.event==='media').length,0);
});
test('a saturated buffer drops all queued data and reports overflow instead of growing indefinitely',t=>{
 t.mock.timers.enable({apis:['setTimeout']});let errors=0;const frames=[];const buffer=new DelayedAudio({delayMs:2500,onFrame:x=>frames.push(x),onOverflow:()=>errors++});t.after(()=>buffer.close());
 for(let i=0;i<=buffer.maxFrames;i++)buffer.push('frame');assert.equal(errors,1);assert.equal(buffer.queue.length,0);assert.equal(frames.length,0);
});
