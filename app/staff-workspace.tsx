"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Download,
  ExternalLink,
  Inbox,
  LoaderCircle,
  Menu,
  Phone,
  RefreshCw,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type {ComplaintListItem} from '../lib/complaint-list';
import {createLatestRequest} from '../lib/latest-request';
import {createSignalRefresh,visibleComplaint} from '../lib/complaint-notifications';
import {missingBusinessContentMessage} from '../lib/analysis-messages';
import {
  autoStates,
  categories,
  statuses,
  type AppSettings,
  type Complaint,
  type Event,
} from "../lib/types";
import PhoneDesk from './phone-desk';
import SaiMark from './sai-mark';
import {
  ComplaintDetail,
} from "./workspace";

type View = "inbox" | "trash" | "phone";
type Overview = {
  complaints: ComplaintListItem[];
  trashComplaints?:ComplaintListItem[];
  settings: AppSettings;
  user: { name: string };
};
const settings: AppSettings = {
  aiReady: false,
  lawReady: false,
  encryptionReady: false,
  model: "gpt-6-luna",
};
const views = {
  phone: "전화 상담",
  inbox: "민원 접수·처리",
  trash:"휴지통",
};
const initialFilter = {
  status: "all",
  category: "all",
  query: "",
  from: "",
  to: "",
};
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    signal,
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result;
}
const dateFormat = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul",
  });
function date(value: string) {
  return dateFormat.format(new Date(value));
}

export default function StaffWorkspace({
  authenticated,
  otherSiteUrl,
}: {
  authenticated: boolean;
  otherSiteUrl: string;
}) {
  const [data, setData] = useState<Overview>({
    complaints: [],
    settings,
    user: { name: "" },
  });
  const [view, setView] = useState<View>("inbox"),
    [selected, setSelected] = useState<Complaint | null>(null),
    [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(authenticated),
    [busy, setBusy] = useState(""),
    [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(
      null,
    ),
    [menu, setMenu] = useState(false);
  const [filter, setFilter] = useState(initialFilter),
    [applied, setApplied] = useState(initialFilter),
    [page, setPage] = useState(1),
    [pageSize, setPageSize] = useState(10);
  const selectedId = useRef<string | null>(null),
    selectedRevision = useRef(0),
    tasksPending = useRef(false),
    generation = useRef(0),
    running = useRef(false);
  const [savingTasks,setSavingTasks]=useState(false);
  const [opening,setOpening]=useState<string|null>(null);
  const openingRef=useRef(false);
  const [detailNavigation]=useState(()=>createLatestRequest((id,signal)=>
    api<{complaint:Complaint;events:Event[]}>("complaints/"+id+"?trash=1","GET",undefined,signal)
  ));
  useEffect(()=>()=>detailNavigation.cancel(),[detailNavigation]);
  const [connectionLost,setConnectionLost]=useState(false);
  const syncSignals=useRef<ReturnType<typeof createSignalRefresh>|null>(null);
  const refresh = useCallback(async () => {
    const next = await api<Overview>("overview");
    setData(next);
    return next;
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    let active = true;
    api<Overview>("overview")
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setNotice({ message: e.message, error: true });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [authenticated]);
  // Database completion signals drive refreshes. No timer checks for analysis results.
  useEffect(() => {
    if (!authenticated) return;
    let active=true,expectedReconnect=false;
    const sync=createSignalRefresh(async()=>{
      const id=selectedId.current;
      const [overview,result]=await Promise.all([
        api<Overview>('overview'),
        id?api<{complaint:Complaint;events:Event[]}>('complaints/'+id+'?trash=1'):Promise.resolve(null)
      ]);
      if(!active)return;
      setData(overview);
      if(running.current||tasksPending.current){sync.signal();return;}
      if(result&&selectedId.current===id&&result.complaint.revision>=selectedRevision.current){
        selectedRevision.current=result.complaint.revision;
        setSelected(result.complaint);setEvents(result.events);
      }
    },()=>running.current||tasksPending.current||openingRef.current,()=>{
      if(active)setNotice({message:'변경된 결과를 불러오지 못했습니다. 새로고침해 주세요.',error:true});
    });
    syncSignals.current=sync;
    const source=new EventSource('/api/complaint-events');
    source.addEventListener('ready',()=>{if(active){expectedReconnect=false;setConnectionLost(false);sync.signal();}});
    source.addEventListener('reconnect',()=>{expectedReconnect=true;});
    source.addEventListener('complaint',()=>{
      if(!active)return;
      sync.signal();
    });
    source.onerror=()=>{if(active&&!expectedReconnect)setConnectionLost(true);};
    return () => {
      active=false;source.close();sync.stop();
      if(syncSignals.current===sync)syncSignals.current=null;
    };
  }, [authenticated]);
  const run = async (label: string, action: () => Promise<void>) => {
    if (running.current || tasksPending.current) return;
    running.current = true;
    setBusy(label);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setNotice({
        message: e instanceof Error ? e.message : "처리하지 못했습니다.",
        error: true,
      });
    } finally {
      running.current = false;
      setBusy("");
      void syncSignals.current?.flush();
    }
  };
  function navigate(next: View) {
    detailNavigation.cancel();openingRef.current=false;setOpening(null);
    generation.current++;
    selectedId.current = null;
    selectedRevision.current=0;
    tasksPending.current=false;setSavingTasks(false);
    setSelected(null);
    setView(next);
    setMenu(false);
    void syncSignals.current?.flush();
  }
  async function detail(id: string) {
    const r = await api<{ complaint: Complaint; events: Event[] }>(
      "complaints/" + id + "?trash=1",
    );
    if (selectedId.current === id && r.complaint.revision>=selectedRevision.current) {
      selectedRevision.current=r.complaint.revision;
      setSelected(r.complaint);
      setEvents(r.events);
    }
  }
  function open(id: string) {
    if(running.current||tasksPending.current)return;
    void detailNavigation.open(id,{
      pending:()=>{openingRef.current=true;setOpening(id);setNotice(null);},
      success:r=>{
        selectedId.current = id;
        selectedRevision.current=r.complaint.revision;
        setSelected(r.complaint);
        setEvents(r.events);
      },
      error:error=>setNotice({message:error instanceof Error?error.message:"민원을 불러오지 못했습니다. 다시 눌러 주세요.",error:true}),
      settled:()=>{openingRef.current=false;setOpening(null);void syncSignals.current?.flush();},
    });
  }
  function statusFilter(status: string) {
    navigate("inbox");
    const next = { ...initialFilter, status };
    setFilter(next);
    setApplied(next);
    setPage(1);
  }
  function search(e: FormEvent) {
    e.preventDefault();
    setApplied(filter);
    setPage(1);
  }
  const readyComplaints=data.complaints.filter(visibleComplaint);
  const filtered = (view==="trash"?(data.trashComplaints||[]):readyComplaints).filter(
    (c) =>
      (applied.status === "all" || c.status === applied.status) &&
      (applied.category === "all" || c.category === applied.category) &&
      (!applied.from || date(c.created_at) >= applied.from) &&
      (!applied.to || date(c.created_at) <= applied.to) &&
      (c.title + " " + c.id + " " + c.location)
        .toLowerCase()
        .includes(applied.query.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)),
    currentPage = Math.min(page, pages);
  // Detail navigation follows time: previous is older, next is newer.
  const chronological = [...filtered].sort((a,b) => Date.parse(a.created_at)-Date.parse(b.created_at) || a.id.localeCompare(b.id));
  const selectedIndex = selected ? chronological.findIndex(c => c.id === selected.id) : -1;
  const count = (status: string) =>
    status === "all"
      ? readyComplaints.length
      : readyComplaints.filter((c) => c.status === status).length;
  function exportCsv() {
    const cell = (s: string) =>
      '"' + s.replace(/^[\s]*[=+@-]/, "'$&").replaceAll('"', '""') + '"';
    const csv =
      "\uFEFF" +
      [
        ["접수번호", "제목", "분야", "처리상태", "접수일"],
        ...filtered.map((c) => [
          c.id,
          c.title,
          c.category,
          statuses[c.status],
          date(c.created_at),
        ]),
      ]
        .map((row) => row.map(cell).join(","))
        .join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "민원접수목록.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="staff-app">
      <a className="skip-link" href="#staff-main">
        본문 바로가기
      </a>
      <header className="admin-header">
        <button
          className="admin-mobile"
          aria-label="업무 메뉴 열기"
          onClick={() => setMenu(!menu)}
        >
          <Menu size={22} />
        </button>
        <button className="admin-brand" onClick={() => navigate("inbox")}>
          <SaiMark size={32}/>
          <strong>민원<span>사이</span></strong>
          <i />
          <b>담당자 업무</b>
        </button>
        <div className="admin-user">
          <a href={otherSiteUrl}>
            <ExternalLink size={15} />
            민원인 홈페이지
          </a>
        </div>
      </header>
      <nav className="admin-nav" aria-label="주 메뉴">
        <button onClick={()=>navigate('phone')} className={view==='phone'?'active':''}><Phone size={18}/>전화 상담</button>
        <button
          onClick={() => navigate("inbox")}
          className={view === "inbox" ? "active" : ""}
        >
          <Inbox size={18} />
          민원 관리
        </button>
      </nav>
      <div className="admin-layout">
        <aside className={"admin-sidebar " + (menu ? "open" : "")}>
          <div className="admin-side-title">
            <span>민원업무</span>
          </div>
          <button
            className={"admin-side-main " + (view === "inbox" ? "active" : "")}
            onClick={() => statusFilter("all")}
          >
            <Inbox size={18} />
            민원 접수함
            <ChevronRight size={15} />
          </button>
          <div className="admin-side-sub">
            {[["all", "전체 민원"], ...Object.entries(statuses)].map(
              ([s, label]) => (
                <button
                  key={s}
                  className={
                    view === "inbox" && applied.status === s ? "active" : ""
                  }
                  onClick={() => statusFilter(s)}
                >
                  <span>{label}</span>
                  <b>{count(s)}</b>
                </button>
              ),
            )}
          </div>
          <button className={"admin-side-main "+(view==="trash"?"active":"")} onClick={()=>{navigate("trash");setFilter(initialFilter);setApplied(initialFilter);setPage(1);}}>휴지통 <b>{data.trashComplaints?.length||0}</b></button>
          <div className="admin-side-divider" />
          <button className={'admin-side-main '+(view==='phone'?'active':'')} onClick={()=>navigate('phone')}><Phone size={18}/>전화 상담</button>
        </aside>
        {menu ? (
          <button
            className="admin-scrim"
            aria-label="업무 메뉴 닫기"
            onClick={() => setMenu(false)}
          />
        ) : null}
        <main id="staff-main" className="admin-content">
          {notice ? (
            <div
              className={"admin-alert " + (notice.error ? "error" : "")}
              role={notice.error ? "alert" : "status"}
            >
              {notice.error ? (
                <AlertCircle size={17} />
              ) : (
                <CheckCircle2 size={17} />
              )}
              <span>{notice.message}</span>
              <button aria-label="알림 닫기" onClick={() => setNotice(null)}>
                <X size={16} />
              </button>
            </div>
          ) : null}
          {connectionLost?<div className="admin-alert error" role="status">실시간 연결이 끊겼습니다. 다시 연결 중입니다.</div>:null}
          <div hidden={view!=='phone'||!!selected}><PhoneDesk staff={true} onRegistered={()=>void refresh()}/></div>
          {view==='phone'&&!selected?null:loading ? (
            <div className="admin-loading">
              <LoaderCircle className="spin" />
              접수 현황을 불러오는 중입니다.
            </div>
          ) : selected ? (
            <>
              {selected.auto_state === "completed" || selected.deleted_at ? null : (
              <div
                className={
                  "admin-processing " + (selected.auto_state || "idle") + (/크레딧|잔액/.test(selected.auto_message||'')?' quota-error':'')
                }
                role="status"
              >
                <span>
                  {["queued", "processing"].includes(
                    selected.auto_state || "",
                  ) ? (
                    <LoaderCircle className="spin" size={20} />
                  ) : (
                    <ClipboardList size={20} />
                  )}
                </span>
                <div>
                  <strong>{selected.deleted_at?"휴지통":selected.auto_message===missingBusinessContentMessage?'내용 확인 필요':/크레딧|잔액/.test(selected.auto_message||'')?'OpenAI 크레딧 확인 필요':autoStates[selected.auto_state || "idle"]}</strong>
                  <p>{selected.auto_message || ""}</p>
                </div>
                {authenticated &&
                selected.auto_state === "failed" &&
                selected.status !== "resolved" && !selected.deleted_at ? (
                  <button
                    className="button outline small"
                    disabled={!!busy}
                    onClick={() =>
                      void run("analyze", async () => {
                        await api(
                          "complaints/" + selected.id + "/analyze",
                          "POST",
                          {},
                        );
                        await detail(selected.id);
                      })
                    }
                  >
                    재시도
                  </button>
                ) : null}
              </div>
              )}
              <div className={!authenticated ? "admin-readonly" : ""}>
                <ComplaintDetail
                  key={selected.id}
                  c={selected}
                  events={events}
                  citizen={false}
                  busy={
                    !authenticated
                      ? "preview"
                      : ["queued", "processing"].includes(
                            selected.auto_state || "",
                          )
                        ? "automatic"
                        : busy || (savingTasks ? "tasks" : "")
                  }
                  lawReady={data.settings.lawReady}
                  navigation={{
                    previous: selectedIndex > 0 ? chronological[selectedIndex - 1].id : undefined,
                    next: selectedIndex >= 0 ? chronological[selectedIndex + 1]?.id : undefined,
                    position: selectedIndex + 1,
                    total: filtered.length,
                    busy: !!opening || !!busy || savingTasks,
                    onNavigate: id => { const index = filtered.findIndex(c => c.id === id); if (index >= 0) setPage(Math.floor(index / pageSize) + 1); open(id); },
                  }}
                  onBack={() => navigate(selected.deleted_at?"trash":"inbox")}
                  onTasksPending={pending=>{
                    if(selectedId.current!==selected.id)return;
                    tasksPending.current=pending;setSavingTasks(pending);
                    if(!pending)void syncSignals.current?.flush();
                  }}
                  onTasksError={message=>setNotice({message,error:true})}
                  onTasksSaved={snapshot=>{
                    const update=(c:Complaint)=>c.id===selected.id&&c.revision<=snapshot.revision?{...c,tasks:snapshot.tasks,revision:snapshot.revision,updated_at:snapshot.updatedAt||c.updated_at}:c;
                    if(selectedId.current!==selected.id || snapshot.revision<selectedRevision.current)return;
                    selectedRevision.current=snapshot.revision;
                    setSelected(previous=>previous?update(previous):previous);
                    if(snapshot.event)setEvents(previous=>previous.some(e=>e.id===snapshot.event!.id)?previous:[snapshot.event!,...previous]);
                  }}
                  onEvidence={() =>
                    void run("evidence", async () => {
                      await api(
                        "complaints/" + selected.id + "/evidence",
                        "POST",
                        {},
                      );
                      await detail(selected.id);
                    })
                  }
                  onUpdate={(input) =>
                    void run(input.action, async () => {
                      await api("complaints/" + selected.id, "PATCH", {
                        revision: selected.revision,
                        ...input,
                      });
                      if(input.action==='delete'||input.action==='restore') {
                        selectedId.current=null;
                        setSelected(null);
                        await refresh();
                        setNotice({message:input.action==='restore'?'민원을 복구했습니다.':'민원을 휴지통으로 이동했습니다.'});
                        return;
                      }
                      await Promise.all([detail(selected.id), refresh()]);
                      setNotice({
                        message:
                          input.action === "approve"
                            ? "검토한 답변이 민원인 홈페이지에 등록되었습니다."
                            : "변경사항을 저장했습니다.",
                      });
                    })
                  }
                />
              </div>
            </>
          ) : view === "inbox" || view === "trash" ? (
            <>
              <div className="admin-heading">
                <div>
                  <h1>{views[view]}</h1>
                </div>
                <div>
                  {view === 'trash' ? <button type="button" className="button outline danger" disabled={!!busy || !authenticated || !data.trashComplaints?.length}
                    onClick={() => {
                      const ids = (data.trashComplaints || []).map(c => c.id);
                      if (!ids.length || !window.confirm(`휴지통의 민원 ${ids.length}건을 영구 삭제하시겠습니까? 삭제한 민원과 첨부자료, 처리 이력은 복구할 수 없습니다.`)) return;
                      void run('purge', async () => {
                        let deleted = 0;
                        try {
                          for (let i = 0; i < ids.length; i += 200) {
                            const result = await api<{ deleted: number }>('complaints/trash', 'DELETE', { ids: ids.slice(i, i + 200) });
                            deleted += result.deleted;
                          }
                          setNotice({ message: `휴지통의 민원 ${deleted}건을 영구 삭제했습니다.` });
                        } finally { await refresh(); }
                      });
                    }}>{busy === 'purge' ? '비우는 중…' : '휴지통 비우기'}</button> : null}
                  <button
                    className="button outline"
                    disabled={!!busy || !authenticated}
                    onClick={() =>
                      void run("refresh", async () => {
                        await refresh();
                      })
                    }
                  >
                    <RefreshCw
                      size={15}
                      className={busy === "refresh" ? "spin" : ""}
                    />
                    새로고침
                  </button>
                </div>
              </div>
              <section className="admin-counters" aria-label="민원 처리 현황" hidden={view==="trash"}>
                {[
                  ["all", "전체 민원"],
                  ["received", "접수 대기"],
                  ["reviewing", "검토 중"],
                  ["resolved", "답변 완료"],
                ].map(([s, label]) => (
                  <button
                    key={s}
                    className={applied.status === s ? "active" : ""}
                    aria-pressed={applied.status === s}
                    onClick={() => statusFilter(s)}
                  >
                    <span>{label}</span>
                    <strong>
                      {count(s)}
                      <small>건</small>
                    </strong>
                  </button>
                ))}
              </section>
              <form className="admin-filter" onSubmit={search}>
                <div className="admin-search-row">
                  <label className="admin-search-label">
                    <span>민원 검색</span>
                    <input
                      placeholder="민원 제목, 접수번호 또는 발생 위치 검색"
                      value={filter.query}
                      onChange={(e) =>
                        setFilter({ ...filter, query: e.target.value })
                      }
                    />
                  </label>
                  <button className="button primary" type="submit">조회</button>
                  <button
                    className="button quiet"
                    type="button"
                    onClick={() => {
                      setFilter(initialFilter);
                      setApplied(initialFilter);
                      setPage(1);
                    }}
                  >
                    초기화
                  </button>
                </div>
                <details className="admin-filter-details">
                  <summary>
                    상세 조건
                    {applied.status !== "all" || applied.category !== "all" || applied.from || applied.to ? <span>적용 중</span> : null}
                  </summary>
                <div className="admin-filter-row">
                  <label>
                    <span>접수 기간</span>
                    <div className="admin-date-range">
                      <input
                        aria-label="접수 시작일"
                        type="date"
                        value={filter.from}
                        max={filter.to || undefined}
                        onChange={(e) =>
                          setFilter({ ...filter, from: e.target.value })
                        }
                      />
                      <i>~</i>
                      <input
                        aria-label="접수 종료일"
                        type="date"
                        value={filter.to}
                        min={filter.from || undefined}
                        onChange={(e) =>
                          setFilter({ ...filter, to: e.target.value })
                        }
                      />
                    </div>
                  </label>
                  <label>
                    <span>처리 상태</span>
                    <select
                      value={filter.status}
                      onChange={(e) =>
                        setFilter({ ...filter, status: e.target.value })
                      }
                    >
                      <option value="all">전체</option>
                      {Object.entries(statuses).map(([s, l]) => (
                        <option key={s} value={s}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>민원 분야</span>
                    <select
                      value={filter.category}
                      onChange={(e) =>
                        setFilter({ ...filter, category: e.target.value })
                      }
                    >
                      <option value="all">전체 분야</option>
                      {categories.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <button className="button outline admin-filter-apply" type="submit">조건 적용</button>
                </details>
              </form>
              <section className="admin-list">
                <div className="admin-list-toolbar">
                  <h2>
                    접수 목록{" "}
                    <span>
                      총 <b>{filtered.length}</b>건
                    </span>
                  </h2>
                  <div>
                    <select
                      aria-label="페이지당 표시 건수"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                    >
                      <option value={10}>10건씩 보기</option>
                      <option value={20}>20건씩 보기</option>
                    </select>
                    <button
                      className="button outline small"
                      onClick={exportCsv}
                    >
                      <Download size={14} />
                      목록 내려받기
                    </button>
                  </div>
                </div>
                <div className="admin-table-scroll">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>번호</th>
                        <th>접수번호 / 민원 제목</th>
                        <th>민원 분야</th>
                        <th>접수일</th>
                        <th>처리 상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered
                        .slice(
                          (currentPage - 1) * pageSize,
                          currentPage * pageSize,
                        )
                        .map((c, i) => (
                          <tr key={c.id}>
                            <td>
                              {filtered.length -
                                (currentPage - 1) * pageSize -
                                i}
                            </td>
                            <td>
                              <button
                                className="admin-complaint-title"
                                onClick={() => open(c.id)}
                                aria-busy={opening===c.id}
                              >
                                <small>
                                  {c.id}

                                </small>
                                <strong>{c.title}</strong>
                                {opening===c.id?<span role="status"><LoaderCircle className="spin" size={14} aria-hidden="true"/> 민원을 불러오는 중입니다.</span>:null}
                                {c.auto_state==='failed'?<span>원문 확인 필요</span>:null}
                                {c.hasSensitiveExpression?<em className="expression-list-flag">주의 표현</em>:null}
                                <span>{c.location}</span>
                              </button>
                            </td>
                            <td>{c.category}</td>
                            <td className="admin-nowrap">
                              {date(c.created_at)}
                            </td>
                            <td>
                              <span className={"admin-status " + c.status}>
                                {statuses[c.status]}
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!filtered.length ? (
                  <div className="admin-empty">
                    <h3>
                      {(view==='trash'?(data.trashComplaints||[]):readyComplaints).length
                        ? "조회 조건에 맞는 민원이 없습니다."
                                : view==='trash'?'휴지통이 비어 있습니다.':'표시할 민원이 없습니다.'}
                    </h3>
                    <p>
                      {(view==='trash'?(data.trashComplaints||[]):readyComplaints).length
                        ? "검색 조건을 변경하여 다시 조회해 주세요."
                        : ""}
                    </p>
                  </div>
                ) : null}
                <div className="admin-table-footer">
                  <div className="admin-pagination">
                    <button
                      aria-label="이전 페이지"
                      disabled={currentPage === 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    {Array.from({ length: pages }, (_, i) => (
                      <button
                        key={i}
                        className={currentPage === i + 1 ? "active" : ""}
                        aria-label={`${i + 1}페이지`}
                        aria-current={
                          currentPage === i + 1 ? "page" : undefined
                        }
                        onClick={() => setPage(i + 1)}
                      >
                        {i + 1}
                      </button>
                    ))}
                    <button
                      aria-label="다음 페이지"
                      disabled={currentPage === pages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                  <span>
                    {currentPage} / {pages} 페이지
                  </span>
                </div>
              </section>
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
