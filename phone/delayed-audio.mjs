// Delay only the caller's playback; AI receives the original frame immediately.
export class DelayedAudio {
  constructor({delayMs=2500,onFrame,onOverflow=()=>{},now=()=>performance.now()}){
    if(!Number.isFinite(delayMs)||delayMs<0||delayMs>10000)throw Error('Invalid_audio_delay');
    Object.assign(this,{delayMs,onFrame,onOverflow,now});this.queue=[];this.timer=null;this.closed=false;
    this.maxFrames=Math.ceil(delayMs/20)+100;
  }
  push(frame){
    if(this.closed)return;
    if(!this.delayMs){this.onFrame(frame);return;}
    if(this.queue.length>=this.maxFrames){this.clear();this.onOverflow();return;}
    this.queue.push({frame,at:this.now()+this.delayMs});this.schedule();
  }
  schedule(){if(this.closed||this.timer||!this.queue.length)return;this.timer=setTimeout(()=>{this.timer=null;this.drain();},Math.max(0,this.queue[0].at-this.now()));}
  drain(){while(!this.closed&&this.queue.length&&this.queue[0].at<=this.now())this.onFrame(this.queue.shift().frame);this.schedule();}
  clear(){clearTimeout(this.timer);this.timer=null;this.queue=[];}
  close(){this.clear();this.closed=true;}
}
