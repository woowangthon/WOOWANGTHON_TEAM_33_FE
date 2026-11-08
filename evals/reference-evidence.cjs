// Recover only an ordered set of verbatim sentences; never change a grade/status.
function contiguousEvidence(draft,quote){
  if(!quote||draft.includes(quote))return {quote,changed:false};
  const parts=quote.split(/(?<=[.!?。！？])\s+/u).map(x=>x.trim()).filter(Boolean);
  if(parts.length<2||parts.some(p=>p.length<4))throw Error('Non-verbatim reference evidence');
  let cursor=0,start=-1;const spans=[];
  for(const part of parts){const index=draft.indexOf(part,cursor);if(index<0)throw Error('Non-verbatim or reordered reference evidence');if(start<0)start=index;cursor=index+part.length;spans.push({start:index,end:cursor,text:part});}
  return {quote:draft.slice(start,cursor),changed:true,originalQuote:quote,spans,start,end:cursor};
}
module.exports={contiguousEvidence};
