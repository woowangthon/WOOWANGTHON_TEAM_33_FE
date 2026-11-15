export function phoneNoticeAudio(kind:string){
  if(kind==='start')return '/demo-audio/call-start-recording.wav';
  if(kind==='text_mode')return '/demo-audio/text-mode-caller-only.wav';
  return null;
}
