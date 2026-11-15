import type {Assistance} from './phone-assistance';

// Used only when the transcript/context snapshot is unchanged between retries.
export function mergeAssistance(previous:Assistance|null,next:Assistance):Assistance{
  if(!previous||previous.callId!==next.callId||previous.inputHash!==next.inputHash)return next;
  const citations=[...new Map([...previous.citations,...next.citations].map(source=>[source.id,source])).values()];
  const validPrevious=previous.items.filter(item=>item.references.every(ref=>citations.some(source=>source.id===ref.citationId&&source.text.includes(ref.quote))));
  const items=[...new Map([...validPrevious,...next.items].map(item=>[item.requestId,item])).values()];
  return {...next,items,citations,pendingRequestIds:next.pendingRequestIds?.filter(id=>!items.some(item=>item.requestId===id))};
}
