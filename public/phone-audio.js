class PhoneAudio extends AudioWorkletProcessor {
  constructor(){super();this.capture=[];this.phase=0;this.sum=0;this.count=0;this.queue=[];this.offset=0;this.playPhase=0;this.muted=false;this.levelSum=0;this.levelCount=0;
    this.port.onmessage=({data})=>{if(data.type==='clear'){this.queue=[];this.offset=0;this.playPhase=0;}if(data.type==='muted')this.muted=data.value;if(data.type==='audio'){this.queue.push(new Uint8Array(data.frame));if(this.queue.length>40){this.queue=this.queue.slice(-10);this.offset=0;}}};}
  encode(v){const sign=v<0?128:0;let m=Math.min(Math.abs(v),32635)+132,e=7;for(let mask=16384;e>0&&!(m&mask);mask>>=1)e--;return ~(sign|(e<<4)|((m>>(e+3))&15))&255;}
  decode(v){const u=~v&255,m=(((u&15)<<3)+132)<<((u>>4)&7);return ((u&128)?132-m:m-132)/32768;}
  process(inputs,outputs){const input=inputs[0]?.[0],out=outputs[0][0],step=8000/sampleRate;
    for(let i=0;i<out.length;i++){
      const sample=input?.[i]||0;this.sum+=sample;this.count++;this.phase+=step;
      this.levelSum+=sample*sample;this.levelCount++;
      if(this.levelCount>=sampleRate/10){this.port.postMessage({type:'level',value:this.muted?0:Math.min(1,Math.sqrt(this.levelSum/this.levelCount)*5)});this.levelSum=0;this.levelCount=0;}
      if(this.phase>=1){this.phase-=1;this.capture.push(this.encode(this.muted?0:Math.round(this.sum/this.count*32767)));this.sum=0;this.count=0;if(this.capture.length===160){const frame=Uint8Array.from(this.capture);this.port.postMessage({type:'frame',frame:frame.buffer},[frame.buffer]);this.capture=[];}}
      out[i]=this.queue.length?this.decode(this.queue[0][this.offset]):0;
      this.playPhase+=step;if(this.playPhase>=1){this.playPhase-=1;if(this.queue.length&&++this.offset>=this.queue[0].length){this.queue.shift();this.offset=0;}}
    }return true;
  }
}
registerProcessor('phone-audio',PhoneAudio);
