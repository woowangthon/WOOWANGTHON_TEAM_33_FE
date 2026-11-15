import {decodeMuLaw} from './audio.mjs';

// Receive immediately; release only frames wholly inside a finalized, approved STT range.
// Playback is paced, not burst into the browser's audio queue. Timeouts never release audio.
export class ReviewedAudio {
  constructor({onFrame,onError=()=>{},maxBufferedMs=30000,now=()=>performance.now()}){
    Object.assign(this,{onFrame,onError,maxBufferedMs,now});this.frames=[];this.turns=[];this.out=[];
    this.position=0;this.boundary=0;this.floor=0;this.timer=null;this.closed=false;
  }
  push(payload){
    if(this.closed)return;
    const startMs=this.position;this.position+=20;
    this.frames.push({payload,startMs,endMs:this.position});
    while(this.frames.length>this.maxBufferedMs/20){
      const expired=this.frames.shift();this.floor=expired.endMs;
      const data=Buffer.from(expired.payload,'base64');let energy=0;
      for(const byte of data){const sample=decodeMuLaw(byte);energy+=sample*sample;}
      if(Math.sqrt(energy/data.length)>420){this.clear();this.onError();return;}
    }
  }
  declare(id,range){
    if(this.closed)return;
    if(!id||!range||!Number.isFinite(range.startMs)||!Number.isFinite(range.endMs)||range.startMs<0||range.endMs<=range.startMs||range.endMs>this.position||this.turns.some(t=>t.id===id)){
      this.clear();this.onError();return;
    }
    if(range.endMs<=this.floor)return;
    // STT can include a silence prefix from before resume. Keep only frames after
    // the cleared boundary, and still require the entire utterance's safe verdict.
    const startMs=Math.max(range.startMs,this.floor);
    if(startMs<this.boundary){this.clear();this.onError();return;}
    this.boundary=range.endMs;this.turns.push({id,startMs,endMs:range.endMs,verdict:null});
  }
  settle(id,allow){
    const turn=this.turns.find(t=>t.id===id);if(this.closed||!turn||turn.verdict!==null)return;
    turn.verdict=allow===true;
    while(this.turns.length&&this.turns[0].verdict!==null){
      const done=this.turns.shift();
      const covered=this.frames.filter(f=>f.startMs>=done.startMs&&f.endMs<=done.endMs);
      this.frames=this.frames.filter(f=>f.endMs>done.endMs);this.floor=Math.max(this.floor,done.endMs);
      if(done.verdict)this.out.push(...covered);
    }
    if(this.out.length>this.maxBufferedMs/20){this.clear();this.onError();return;}
    this.schedule();
  }
  schedule(){
    if(this.closed||this.timer||!this.out.length)return;
    this.timer=setTimeout(()=>{this.timer=null;if(this.closed)return;const frame=this.out.shift();if(frame)this.onFrame(frame.payload,{startMs:frame.startMs,endMs:frame.endMs});this.schedule();},20);
  }
  clear(){clearTimeout(this.timer);this.timer=null;this.frames=[];this.turns=[];this.out=[];this.floor=this.position;this.boundary=this.position;}
  close(){this.clear();this.closed=true;}
}
