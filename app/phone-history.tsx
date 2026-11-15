'use client';

export type CallEntry={id:string;callerId?:string;callerName?:string;callerCallCount?:number;startedAt:string;status:'waiting'|'connecting'|'active'|'ended'};
const statusLabel={waiting:'수신 중',connecting:'연결 중',active:'통화 중',ended:'종료'};
const dateLabel=(value:string)=>new Date(value).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'});
const identity=(call:CallEntry)=>call.callerId||call.id;

export default function PhoneHistory({calls,selected,onSelect,loading,error,onRetry}:{calls:CallEntry[];selected:string;onSelect:(id:string)=>void;loading:boolean;error:string;onRetry:()=>void}){
  const ordered=[...calls].sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  const callers=[...new Map([...ordered].reverse().map(call=>[identity(call),call])).values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  const selectedCall=calls.find(call=>call.id===selected);
  const history=selectedCall?ordered.filter(call=>identity(call)===identity(selectedCall)):[];
  return <aside className="phone-history" aria-label="상담 목록 및 이전 내역">
    <header className="phone-history-heading"><h2>상담 목록</h2><span>{callers.length}</span></header>
    {error?<div className="phone-history-empty" role="status">{error}<button onClick={onRetry}>다시 불러오기</button></div>:loading&&!calls.length?<p className="phone-history-empty">목록을 불러오는 중입니다.</p>:!callers.length?<p className="phone-history-empty">아직 상담 내역이 없습니다.</p>:null}
    <div className="phone-history-callers">
      {callers.map(call=><button key={identity(call)} className={'phone-history-person '+(selectedCall&&identity(call)===identity(selectedCall)?'selected':'')} aria-pressed={!!selectedCall&&identity(call)===identity(selectedCall)} onClick={()=>onSelect(call.id)}>
        <strong>{call.callerName||'민원인'}</strong><span>통화 {call.callerCallCount||calls.filter(c=>identity(c)===identity(call)).length}회</span><small>{dateLabel(call.startedAt)} · {statusLabel[call.status]}</small>
      </button>)}
    </div>
    {selectedCall&&<section className="phone-history-previous" aria-label="선택한 민원인의 상담 내역">
      <h3>{selectedCall.callerName||'민원인'}의 상담 내역</h3>
      <div className="phone-history-entries">{history.map(call=><button key={call.id} className={'phone-history-entry '+(call.id===selected?'selected':'')} aria-pressed={call.id===selected} onClick={()=>onSelect(call.id)}><time dateTime={call.startedAt}>{dateLabel(call.startedAt)}</time><span>{statusLabel[call.status]}</span></button>)}</div>
    </section>}
  </aside>;
}
