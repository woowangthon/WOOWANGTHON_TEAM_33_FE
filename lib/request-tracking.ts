import type {Complaint,RequestTracking,TrackedRequest,RequestProgress,RequirementAudit} from './types';

export const progressLabels:Record<RequestProgress,string>={received:'접수',waiting:'추가 정보 대기',in_progress:'처리 중',completed:'처리 완료',unavailable:'처리 불가'};
export class TrackingError extends Error {}
export function seedTracking(c:Pick<Complaint,'request_tracking'|'analysis'|'coverage_review'>,audit?:RequirementAudit):RequestTracking {
  if(c.request_tracking&&(c.request_tracking.items.length||c.request_tracking.confirmedAt))return c.request_tracking;
  const texts=(audit?.requirements||c.coverage_review?.requirements)?.map(r=>r.text)||c.analysis?.requests||[];
  return {version:1,confirmedAt:null,items:[...new Set(texts)].slice(0,30).map((text,i)=>({id:'Q'+(i+1),text,originalText:text,withdrawn:false,state:'received',note:'',history:[]}))};
}
function history(item:TrackedRequest,actor:'citizen'|'staff',action:TrackedRequest['history'][number]['action'],at:string,note:string) {
  if(item.history.length>=100)throw new TrackingError('이 요구의 변경 이력이 최대 개수에 도달했습니다. 담당자에게 문의해 주세요.');
  item.history.push({at,actor,action,text:item.text,state:item.state,withdrawn:item.withdrawn,note});
}
export function confirmRequests(previous:RequestTracking,rows:{id?:string;text:string;withdrawn:boolean}[],at:string):RequestTracking {
  if(rows.length>30)throw new TrackingError('요구사항은 최대 30개입니다.');
  const known=new Map(previous.items.map(r=>[r.id,r]));const seen=new Set<string>();
  const items=rows.map(row=>{
    const text=row.text.trim();if(text.length<2||text.length>600)throw new TrackingError('각 요구사항을 2~600자로 작성해 주세요.');
    if(row.id&&(!known.has(row.id)||seen.has(row.id)))throw new TrackingError('요구 목록이 변경되었습니다. 다시 확인해 주세요.');
    if(row.id)seen.add(row.id);
    const old=row.id?known.get(row.id):undefined;
    const item:TrackedRequest=old?structuredClone(old):{id:crypto.randomUUID(),text,originalText:text,withdrawn:false,state:'received',note:'',history:[]};
    const changed=item.text!==text||item.withdrawn!==row.withdrawn;
    item.text=text;item.withdrawn=row.withdrawn;
    if(changed){item.state='received';item.note='';}
    history(item,'citizen',changed||!old?'edit':'confirm',at,changed?'시민이 요구를 수정했습니다.':'시민이 요구를 확인했습니다.');return item;
  });
  if(seen.size!==known.size)throw new TrackingError('기존 요구는 삭제하지 않고 요청 철회로 표시해 주세요.');
  if(items.length===0)throw new TrackingError('확인할 요구를 한 개 이상 입력해 주세요.');
  const active=items.filter(r=>!r.withdrawn).map(r=>r.text.replace(/\s/g,''));
  if(new Set(active).size!==active.length)throw new TrackingError('같은 요구가 중복되어 있습니다.');
  return {version:1,confirmedAt:at,items};
}
export function updateProgress(previous:RequestTracking,id:string,state:RequestProgress,note:string,at:string):RequestTracking {
  const next=structuredClone(previous),item=next.items.find(r=>r.id===id);note=note.trim();
  if(!item||item.withdrawn)throw new TrackingError('처리할 요구사항을 찾을 수 없습니다.');
  if(!Object.hasOwn(progressLabels,state))throw new TrackingError('처리 상태를 확인해 주세요.');
  if(note.length<5||note.length>2000)throw new TrackingError(state==='completed'?'실제 처리 결과를 5자 이상 기록해 주세요.':state==='waiting'?'필요한 추가 정보를 구체적으로 작성해 주세요.':'변경 사유를 5~2,000자로 기록해 주세요.');
  item.state=state;item.note=note;history(item,'staff','progress',at,note);return next;
}
export function replyToRequest(previous:RequestTracking,id:string,text:string,at:string):RequestTracking {
  const next=structuredClone(previous),item=next.items.find(r=>r.id===id);text=text.trim();
  if(!item||item.withdrawn||item.state!=='waiting')throw new TrackingError('추가 정보를 요청받은 요구에만 답변할 수 있습니다.');
  if(text.length<2||text.length>2000)throw new TrackingError('추가 정보를 2~2,000자로 입력해 주세요.');
  item.state='received';item.note='추가 정보가 접수되어 담당자 확인을 기다리고 있습니다.';history(item,'citizen','reply',at,text);return next;
}
export function trackingCounts(tracking:RequestTracking) {
  const active=tracking.items.filter(r=>!r.withdrawn);
  return {active:active.length,completed:active.filter(r=>r.state==='completed').length,unavailable:active.filter(r=>r.state==='unavailable').length,pending:active.filter(r=>!['completed','unavailable'].includes(r.state)).length};
}
