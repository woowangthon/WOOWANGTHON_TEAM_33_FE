import type { Event, Task } from './types';

export type TaskSnapshot = { revision:number; tasks:Task[]; updatedAt?:string; event?:Event };
export type TaskView = { tasks:Task[]; saving:boolean; error:string };

// One writer per open checklist. Pending choices are overlaid on confirmed data.
export function createTaskSaveQueue(initial:TaskSnapshot, options:{
  save:(snapshot:TaskSnapshot)=>Promise<TaskSnapshot>;
  load:()=>Promise<TaskSnapshot>;
  changed:(view:TaskView)=>void;
  confirmed:(snapshot:TaskSnapshot)=>void;
  failed?:(message:string)=>void;
}) {
  let base=initial, saving=false, error='';
  const pending=new Map<string,boolean>();
  const tasks=()=>base.tasks.map(task=>pending.has(task.id)?{...task,done:pending.get(task.id)!}:task);
  const publish=()=>options.changed({tasks:tasks(),saving,error});
  function accept(snapshot:TaskSnapshot) {
    if(snapshot.revision>=base.revision)base=snapshot;
  }
  async function flush() {
    if(saving)return;
    saving=true;publish();
    let conflicts=0;
    try {
      while(pending.size) {
        const sent=new Map(pending);
        try {
          const result=await options.save({revision:base.revision,tasks:tasks()});
          accept(result);
          for(const [id,done] of sent)if(pending.get(id)===done)pending.delete(id);
          options.confirmed(result);
          conflicts=0;
          publish();
        } catch(cause) {
          if((cause as {status?:number})?.status===409&&conflicts++<2) {
            const latest=await options.load();
            accept(latest);options.confirmed(latest);
            if([...pending.keys()].some(id=>!base.tasks.some(t=>t.id===id)))throw new Error('Task removed');
            publish();
            continue;
          }
          throw cause;
        }
      }
    } catch {
      // A response can be lost after a successful write; reconcile before rollback.
      try { const latest=await options.load();accept(latest);options.confirmed(latest); } catch { /* Keep last confirmed data. */ }
      pending.clear();
      error='저장하지 못했습니다. 상태를 확인하고 다시 체크해 주세요.';
      options.failed?.(error);
    } finally {saving=false;publish();}
  }
  return {
    set(id:string,done:boolean) {
      if(!base.tasks.some(t=>t.id===id))return;
      pending.set(id,done);error='';
      // Publish synchronously, before any network response can arrive.
      saving?publish():void flush();
    },
    sync(snapshot:TaskSnapshot) {if(snapshot.revision>base.revision){accept(snapshot);publish();}},
  };
}
