class PhoneAudio extends AudioWorkletProcessor {
  constructor(){super();this.capture=[];this.phase=0;this.sum=0;this.count=0;this.queue=[];this.offset=0;this.playPhase=0;this.muted=false;this.levelSum=0;this.levelCount=0;this.captureFormat='mulaw';
    this.port.onmessage=({data})=>{if(data.type==='clear'){this.queue=[];this.offset=0;this.playPhase=0;}if(data.type==='capture_format'||data.type==='muted'){if(data.type==='capture_format')this.captureFormat=data.format==='pcm16-16000'?data.format:'mulaw';else this.muted=data.value;this.capture=[];this.phase=0;this.sum=0;this.count=0;}if(data.type==='audio'){this.queue.push(new Uint8Array(data.frame));if(this.queue.length>40){this.queue=this.queue.slice(-10);this.offset=0;}}};}
  encode(v){const sign=v<0?128:0;let m=Math.min(Math.abs(v),32635)+132,e=7;for(let mask=16384;e>0&&!(m&mask);mask>>=1)e--;return ~(sign|(e<<4)|((m>>(e+3))&15))&255;}
  decode(v){const u=~v&255,m=(((u&15)<<3)+132)<<((u>>4)&7);return ((u&128)?132-m:m-132)/32768;}
  process(inputs,outputs){const input=inputs[0]?.[0],out=outputs[0][0],step=8000/sampleRate,pcm=this.captureFormat==='pcm16-16000',captureRate=pcm?16000:8000;
    for(let i=0;i<out.length;i++){
      const sample=input?.[i]||0;this.sum+=sample;this.count++;this.phase+=captureRate/sampleRate;
      this.levelSum+=sample*sample;this.levelCount++;
      if(this.levelCount>=sampleRate/10){this.port.postMessage({type:'level',value:this.muted?0:Math.min(1,Math.sqrt(this.levelSum/this.levelCount)*5)});this.levelSum=0;this.levelCount=0;}
      if(this.phase>=1){this.phase-=1;const value=this.muted?0:Math.max(-32768,Math.min(32767,Math.round(this.sum/this.count*32767)));this.capture.push(pcm?value:this.encode(value));this.sum=0;this.count=0;if(this.capture.length===captureRate/50){let frame;if(pcm){frame=new Uint8Array(640);const view=new DataView(frame.buffer);this.capture.forEach((v,index)=>view.setInt16(index*2,v,true));}else frame=Uint8Array.from(this.capture);this.port.postMessage({type:'frame',format:pcm?'pcm16-16000':undefined,frame:frame.buffer},[frame.buffer]);this.capture=[];}}
      out[i]=this.queue.length?this.decode(this.queue[0][this.offset]):0;
      this.playPhase+=step;if(this.playPhase>=1){this.playPhase-=1;if(this.queue.length&&++this.offset>=this.queue[0].length){this.queue.shift();this.offset=0;}}
    }return true;
  }
}
registerProcessor('phone-audio',PhoneAudio);
