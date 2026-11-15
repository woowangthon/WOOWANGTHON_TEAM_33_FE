export type HistoryCall={id:string;callerId?:string;status:'waiting'|'connecting'|'active'|'ended';startedAt:string};

export function phoneHistoryScope<T extends HistoryCall>(calls:T[],ownedCallId=''){
  const live=calls.filter(call=>call.status!=='ended');
  const current=live.find(call=>call.id===ownedCallId)
    ||live.find(call=>call.status==='active')
    ||live.find(call=>call.status==='connecting')
    ||live.find(call=>call.status==='waiting');
  const history=current?calls.filter(call=>call.id===current.id||!!current.callerId&&call.callerId===current.callerId).sort((a,b)=>b.startedAt.localeCompare(a.startedAt)):[];
  return {current,history};
}

export function phoneHistorySelection<T extends HistoryCall>(calls:T[],ownedCallId:string,previousSelection:string,previousCallId:string){
  const scope=phoneHistoryScope(calls,ownedCallId);
  return scope.current?.id===previousCallId&&scope.history.some(call=>call.id===previousSelection)
    ?previousSelection:scope.current?.id||'';
}

export function archivedPhoneCalls<T extends HistoryCall>(calls:T[]){
  return calls.filter(call=>call.status==='ended').sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
}
