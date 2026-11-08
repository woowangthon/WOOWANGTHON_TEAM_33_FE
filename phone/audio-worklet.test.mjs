import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../public/phone-audio.js',import.meta.url),'utf8');
function processor(rate){
  let Processor;const messages=[];
  vm.runInNewContext(code,{AudioWorkletProcessor:class{constructor(){this.port={postMessage:message=>messages.push(message)};}},sampleRate:rate,registerProcessor:(_name,value)=>{Processor=value;}});
  const instance=new Processor();
  const render=(samples,value=0)=>{const output=new Float32Array(samples);instance.process([[new Float32Array(samples).fill(value)]],[[output]]);return output;};
  return{instance,messages,render,command:data=>instance.port.onmessage({data})};
}
for(const rate of [44100,48000])test(`browser worklet at ${rate} Hz preserves duplex audio and clears queued caller speech`,()=>{
  const audio=processor(rate);audio.render(rate,.25);
  const frames=audio.messages.filter(message=>message.type==='frame');assert.ok(frames.length>=49&&frames.length<=50);assert.equal(new Uint8Array(frames[0].frame).length,160);
  assert.ok(audio.messages.some(message=>message.type==='level'&&message.value>0));
  audio.command({type:'audio',frame:new Uint8Array(160).fill(128).buffer});assert.ok(audio.render(128).some(value=>value!==0));
  audio.command({type:'clear'});assert.ok(audio.render(128).every(value=>value===0));
  audio.command({type:'muted',value:true});audio.render(rate);
  assert.ok(new Uint8Array(audio.messages.filter(message=>message.type==='frame').at(-1).frame).every(value=>value===255));
  audio.command({type:'audio',frame:new Uint8Array(160).fill(128).buffer});assert.ok(audio.render(128).some(value=>value!==0),'microphone mute must not mute incoming speech');
});
