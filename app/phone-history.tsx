'use client';

export type CallEntry={id:string;callerId?:string;callerName?:string;callerCallCount?:number;startedAt:string;status:'waiting'|'connecting'|'active'|'ended'};
const statusLabel={waiting:'수신 중',connecting:'연결 중',active:'통화 중',ended:'종료'};
const dateLabel=(value:string)=>new Date(value).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'});
const identity=(call:CallEntry)=>call.callerId||call.id;

export default function PhoneHistory({calls,selected,onSelect,archive,loading,error,onToggleArchive}:{calls:CallEntry[];selected:string;onSelect:(id:string)=>void;archive:boolean;loading:boolean;error:string;onToggleArchive:()=>void}){
  const ordered=[...calls].sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  const callers=[...new Map([...ordered].reverse().map(call=>[identity(call),call])).values()].sort((a,b)=>b.startedAt.localeCompare(a.startedAt));
  const selectedCall=calls.find(call=>call.id===selected);
  const history=selectedCall?ordered.filter(call=>identity(call)===identity(selectedCall)):[];
  return <aside className="phone-history" aria-label="상담 목록 및 이전 내역">
    <header className="phone-history-heading"><h2>{archive?'이전 상담':'상담 목록'}</h2><span>{callers.length}</span></header>
    <div className="phone-history-tools"><button type="button" onClick={onToggleArchive} aria-pressed={archive}>{archive?'수신 목록':'이전 상담'}</button></div>
    {loading&&<p className="phone-history-empty" role="status">상담 기록을 불러오는 중입니다.</p>}
    {error&&<p className="phone-history-empty" role="alert">{error}</p>}
    {archive&&!loading&&!error&&!calls.length&&<p className="phone-history-empty">저장된 상담이 없습니다.</p>}
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
