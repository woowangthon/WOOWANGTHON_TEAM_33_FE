import {decodeMuLaw} from './audio.mjs';
// Bounded local endpointing. Keep pre-roll and trailing silence; never send standby silence to AI.
export class Segmenter {
  constructor({onStart,onFrame,onEnd,threshold=420,silenceFrames=30,maxFrames=500}){Object.assign(this,{onStart,onFrame,onEnd,threshold,silenceFrames,maxFrames});this.pre=[];this.active=false;this.frames=[];this.silent=0;this.voiced=0;}
  push(frame){
    let energy=0;for(const sample of frame){const n=decodeMuLaw(sample);energy+=n*n;}
    const speech=Math.sqrt(energy/frame.length)>this.threshold;
    if(!this.active){this.pre.push(frame);if(this.pre.length>10)this.pre.shift();if(!speech)return;this.active=true;this.frames=[];this.voiced=0;this.silent=0;this.onStart();for(const p of this.pre){this.frames.push(p);this.onFrame(p);}this.pre=[];}
    else{this.frames.push(frame);this.onFrame(frame);}
    if(speech){this.voiced++;this.silent=0;}else this.silent++;
    if(this.silent>=this.silenceFrames||this.frames.length>=this.maxFrames)this.flush();
  }
  flush(){if(!this.active)return;const audio=Buffer.concat(this.frames);this.active=false;this.frames=[];this.pre=[];this.onEnd(audio,this.voiced>=3);}
}
