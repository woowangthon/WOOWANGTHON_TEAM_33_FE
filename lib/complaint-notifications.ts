import { PUBLIC_OFFICE } from './access';
import type { Complaint } from './types';

export type ComplaintNotification={id:string;revision:number;kind:'completed'|'updated'|'failed'};
export function visibleComplaint(c:Complaint) {
  return (c.auto_state==='completed' && !!c.analysis) || c.status==='resolved' || c.auto_state==='failed';
}
export function notificationForOffice(payload:string|undefined,office:string):ComplaintNotification|null {
  try {
    const value=JSON.parse(payload||'');
    if(!value || typeof value.owner!=='string' || typeof value.id!=='string' ||
      !Number.isSafeInteger(value.revision) || !['completed','updated','failed'].includes(value.kind))return null;
    const permitted=office===PUBLIC_OFFICE?value.owner.startsWith('guest:'):
      office.startsWith('guest:')?value.owner===office:!value.owner.startsWith('guest:');
    return permitted?{id:value.id,revision:value.revision,kind:value.kind}:null;
  }catch{return null;}
}

// Signals are coalesced while a save or refresh is in flight; no recurring timer or polling.
export function createSignalRefresh(refresh:()=>Promise<void>,blocked:()=>boolean,onError:()=>void) {
  let dirty=false,running=false,stopped=false;
  async function flush() {
    if(running||stopped||blocked())return;
    running=true;
    try {
      while(dirty&&!stopped&&!blocked()) {
        dirty=false;
        try{await refresh();}catch{onError();break;}
      }
    }finally{running=false;}
  }
  return {signal(){dirty=true;void flush();},flush,stop(){stopped=true;dirty=false;}};
}
