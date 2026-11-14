import type { Event, Task } from './types';

export function taskChangeLabels(previous:Task[],next:Task[]):string[] {
  return previous.flatMap(task=>{
    const changed=next.find(t=>t.id===task.id);
    return changed&&changed.done!==task.done
      ? [`${changed.done?'완료':'완료 취소'}: ${task.label}`] : [];
  });
}

export function summarizeHistory(events:Event[]):Event[] {
  const result:Event[]=[];
  for(let i=0;i<events.length;i++) {
    const event=events[i];
    if(event.label!=='후속 조치 체크리스트 변경'){result.push(event);continue;}
    let count=1;
    while(events[i+1]?.label===event.label){count++;i++;}
    // Old records contain no item IDs or before/after values. Do not invent them.
    result.push({...event,label:`이전 후속 조치 변경 ${count}회`});
  }
  return result;
}
