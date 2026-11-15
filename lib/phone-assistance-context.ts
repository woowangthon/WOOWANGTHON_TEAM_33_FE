import type {AssistanceInput} from './phone-assistance';

type RecordedCall={id:string;callerId?:string;startedAt:string;status:string;messages?:{id?:string;speaker:'caller'|'staff';text:string;at:string}[];segments:{text:string}[]};

export function phoneAssistanceContext(calls:RecordedCall[],selected:string):Pick<AssistanceInput,'conversation'|'priorCalls'>{
  const current=calls.find(call=>call.id===selected);
  if(!current)return {conversation:[],priorCalls:[]};
  // Bound context size without turning old requests into current requests.
  let remaining=12000;
  const conversation=(current.messages||[]).slice(-40).reverse().flatMap(message=>{
    if(remaining<=0)return [];
    const text=message.text.slice(0,Math.min(1500,remaining));remaining-=text.length;
    return [{turnId:message.id,speaker:message.speaker,text,at:message.at}];
  }).reverse();
  remaining=18000;
  const priorCalls=current.callerId?calls.filter(call=>call.id!==current.id&&call.callerId===current.callerId&&call.status==='ended'&&call.startedAt<current.startedAt)
    .sort((a,b)=>b.startedAt.localeCompare(a.startedAt)).slice(0,5).flatMap(call=>{
      const full=call.messages?.length?call.messages.map(message=>(message.speaker==='staff'?'담당자':'민원인')+': '+message.text).join('\n'):call.segments.map(segment=>segment.text).join('\n');
      if(!full.trim()||remaining<=0)return [];
      const transcript=full.slice(0,Math.min(6000,remaining));remaining-=transcript.length;
      return [{callId:call.id,startedAt:call.startedAt,transcript,excerpted:transcript.length<full.length}];
    }):[];
  return {conversation,priorCalls};
}
