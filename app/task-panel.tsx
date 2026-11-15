'use client';

import { useEffect, useRef, useState } from 'react';
import { createTaskSaveQueue, type TaskSnapshot, type TaskView } from '../lib/task-save-queue';
import type { Complaint } from '../lib/types';

export default function TaskPanel({complaint,disabled,onSaved,onPending,onError}:{
  complaint:Complaint;disabled:boolean;
  onSaved:(snapshot:TaskSnapshot)=>void;
  onPending:(pending:boolean)=>void;
  onError:(message:string)=>void;
}) {
  const callbacks=useRef({onSaved,onPending,onError});
  callbacks.current={onSaved,onPending,onError};
  const active=useRef(true);
  const [view,setView]=useState<TaskView>({tasks:complaint.tasks,saving:false,error:''});
  const [queue]=useState(()=>createTaskSaveQueue(complaint,{
    save:async snapshot=>{
      const response=await fetch(`/api/complaints/${complaint.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'tasks',...snapshot}),signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw Object.assign(new Error('Save failed'),{status:response.status});
      return response.json();
    },
    load:async()=>{
      const response=await fetch(`/api/complaints/${complaint.id}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Reload failed');
      return (await response.json()).complaint;
    },
    changed:next=>{if(active.current)setView(next);callbacks.current.onPending(next.saving);},
    confirmed:next=>callbacks.current.onSaved(next),
    failed:message=>callbacks.current.onError(message),
  }));
  useEffect(()=>{active.current=true;return ()=>{active.current=false;};},[]);
  useEffect(()=>queue.sync(complaint),[queue,complaint.revision,complaint.tasks]);
  return <section className="card task-panel">
    <div className="section-heading"><h3>후속 조치</h3><span>{view.tasks.filter(t=>t.done).length}/{view.tasks.length}</span></div>
    {view.tasks.length?view.tasks.map(task=><label key={task.id} className={'task-item '+(task.done?'done':'')}>
      <input type="checkbox" checked={task.done} disabled={disabled} onChange={e=>queue.set(task.id,e.target.checked)}/>
      <span>{task.label}</span>
    </label>):<p className="muted-text">등록된 후속 조치가 없습니다.</p>}
    <p className="task-save-status" role={view.error?'alert':'status'}>{view.error|| (view.saving?'저장 중…':'')}</p>
  </section>;
}
