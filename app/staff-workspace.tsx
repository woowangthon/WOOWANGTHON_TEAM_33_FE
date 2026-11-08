"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ShieldCheck,
  Inbox,
  BookOpen,
  ChevronRight,
  ChevronLeft,
  RefreshCw,
  Search,
  Plus,
  Download,
  ExternalLink,
  UserRound,
  LogIn,
  CheckCircle2,
  AlertCircle,
  LoaderCircle,
  Menu,
  X,
  House,
  ClipboardList,
} from "lucide-react";
import {
  autoStates,
  categories,
  statuses,
  type Complaint,
  type Event,
  type AppSettings,
  type LawDocument,
  type Status,
} from "../lib/types";
import {
  ComplaintDetail,
  Portal,
  LibraryView,
} from "./workspace";
import { protectedTitle, expressionFindings } from '../lib/protection';
import PhoneDesk from './phone-desk';

type View = "inbox" | "intake" | "library" | "trash" | "phone";
type Overview = {
  complaints: Complaint[];
  trashComplaints?:Complaint[];
  settings: AppSettings;
  documents: LawDocument[];
  user: { name: string };
};
const settings: AppSettings = {
  geminiReady: false,
  lawReady: false,
  encryptionReady: false,
  model: "gemini-2.5-flash-lite",
};
const views = {
  phone: "전화 상담",
  inbox: "민원 접수·처리",
  trash:"휴지통",
  intake: "민원 직접 등록",
  library: "법령·조례 자료실",
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
): Promise<T> {
  const response = await fetch("/api/" + path, {
    method,
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "요청을 처리하지 못했습니다.");
  return result;
}
function date(value: string) {
  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
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
    documents: [],
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
    generation = useRef(0),
    running = useRef(false);
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
  // Poll the shared inbox, so submissions from the citizen site appear without a reload.
  useEffect(() => {
    if (!authenticated) return;
    let active = true,
      inFlight = false;
    const timer = setInterval(async () => {
      if (document.hidden || inFlight || running.current) return;
      inFlight = true;
      try {
        // An open complaint only needs its own record; the full inbox is
        // refreshed while browsing the list. Keeps database egress small.
        const id = selectedId.current;
        if (!id) {
          const d = await api<Overview>("overview?poll=1");
          if (active) setData((prev) => ({ ...prev, ...d }));
        } else {
          const result = await api<{ complaint: Complaint; events: Event[] }>(
            "complaints/" + id + "?trash=1",
          );
          if (active && selectedId.current === id) {
            setSelected(result.complaint);
            setEvents(result.events);
          }
        }
      } catch {
        /* Explicit refresh surfaces errors; transient background failures do not dismiss the editor. */
      } finally {
        inFlight = false;
      }
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [authenticated]);
  const run = async (label: string, action: () => Promise<void>) => {
    if (running.current) return;
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
    }
  };
  function navigate(next: View) {
    generation.current++;
    selectedId.current = null;
    setSelected(null);
    setView(next);
    setMenu(false);
  }
  async function detail(id: string) {
    const r = await api<{ complaint: Complaint; events: Event[] }>(
      "complaints/" + id + "?trash=1",
    );
    if (selectedId.current === id) {
      setSelected(r.complaint);
      setEvents(r.events);
    }
  }
  function open(id: string) {
    const token = ++generation.current;
    void run("open", async () => {
      const r = await api<{ complaint: Complaint; events: Event[] }>(
        "complaints/" + id + "?trash=1",
      );
      if (token === generation.current) {
        selectedId.current = id;
        setSelected(r.complaint);
        setEvents(r.events);
      }
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
  const filtered = (view==="trash"?(data.trashComplaints||[]):data.complaints).filter(
    (c) =>
      (applied.status === "all" || c.status === applied.status) &&
      (applied.category === "all" || c.category === applied.category) &&
      (!applied.from || date(c.created_at) >= applied.from) &&
      (!applied.to || date(c.created_at) <= applied.to) &&
      (c.title + " " + protectedTitle(c) + " " + c.id + " " + c.location)
        .toLowerCase()
        .includes(applied.query.trim().toLowerCase()),
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize)),
    currentPage = Math.min(page, pages);
  const count = (status: string) =>
    status === "all"
      ? data.complaints.length
      : data.complaints.filter((c) => c.status === status).length;
  const heading = selected ? "민원 상세 검토" : views[view];
  function exportCsv() {
    const cell = (s: string) =>
      '"' + s.replace(/^[\s]*[=+@-]/, "'$&").replaceAll('"', '""') + '"';
    const csv =
      "\uFEFF" +
      [
        ["접수번호", "제목", "분야", "처리상태", "자동분석", "접수일"],
        ...filtered.map((c) => [
          c.id,
          protectedTitle(c),
          c.category,
          statuses[c.status],
          autoStates[c.auto_state || "idle"],
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
          <span>
            <ShieldCheck size={30} />
          </span>
          <strong>민원쉴드</strong>
          <i />
          <b>민원업무관리시스템</b>
        </button>
        <div className="admin-user">
          <a href={otherSiteUrl}>
            <ExternalLink size={15} />
            민원인 홈페이지
          </a>
        </div>
      </header>
      <nav className="admin-nav" aria-label="주 메뉴">
        <button onClick={()=>navigate('phone')} className={view==='phone'?'active':''}><ShieldCheck size={18}/>전화 상담</button>
        <button
          onClick={() => navigate("inbox")}
          className={view === "inbox" || view === "intake" ? "active" : ""}
        >
          <Inbox size={18} />
          민원 관리
        </button>
        <button
          onClick={() => navigate("library")}
          className={view === "library" ? "active" : ""}
        >
          <BookOpen size={18} />
          법령·조례
        </button>
      </nav>
      <div className="admin-layout">
        <aside className={"admin-sidebar " + (menu ? "open" : "")}>
          <div className="admin-side-title">
            <span>민원업무</span>
            <strong>청주시</strong>
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
          <button
            className="admin-side-main"
            onClick={() => navigate("intake")}
          >
            <ClipboardList size={18} />
            직접 등록
          </button>
          <button className={"admin-side-main "+(view==="trash"?"active":"")} onClick={()=>{navigate("trash");setFilter(initialFilter);setApplied(initialFilter);setPage(1);}}>휴지통 <b>{data.trashComplaints?.length||0}</b></button>
          <div className="admin-side-divider" />
          <button className={'admin-side-main '+(view==='phone'?'active':'')} onClick={()=>navigate('phone')}><ShieldCheck size={18}/>전화 상담</button>
          <button
            className="admin-side-main"
            onClick={() => navigate("library")}
          >
            <BookOpen size={18} />
            법령·조례 자료실
          </button>
        </aside>
        {menu ? (
          <button
            className="admin-scrim"
            aria-label="업무 메뉴 닫기"
            onClick={() => setMenu(false)}
          />
        ) : null}
        <main id="staff-main" className="admin-content">
          <div className="admin-breadcrumb">
            <House size={13} />
            <span>업무포털</span>
            <ChevronRight size={12} />
            <span>민원 관리</span>
            <ChevronRight size={12} />
            <strong>{heading}</strong>
          </div>
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
          <div hidden={view!=='phone'||!!selected}><PhoneDesk staff={true} onRegistered={()=>void refresh()}/></div>
          {view==='phone'&&!selected?null:loading ? (
            <div className="admin-loading">
              <LoaderCircle className="spin" />
              접수 현황을 불러오는 중입니다.
            </div>
          ) : selected ? (
            <>
              {selected.auto_state === "completed" &&
              selected.status !== "waiting" &&
              !selected.deleted_at ? null : (
              <div
                className={
                  "admin-processing " + (selected.auto_state || "idle")
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
                  <strong>{selected.deleted_at?"휴지통":selected.status==="waiting"?"보완 답변 대기":autoStates[selected.auto_state || "idle"]}</strong>
                  <p>{selected.auto_message || ""}</p>
                </div>
                {authenticated &&
                !["queued", "processing"].includes(selected.auto_state || "") &&
                selected.status !== "resolved" && !selected.deleted_at && selected.status!=="waiting" ? (
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
                    자동 분석 재시도
                  </button>
                ) : null}
              </div>
              )}
              <div className={!authenticated ? "admin-readonly" : ""}>
                <ComplaintDetail
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
                        : busy
                  }
                  ready={data.settings.aiReady ?? data.settings.geminiReady}
                  lawReady={data.settings.lawReady}
                  onBack={() => navigate(selected.deleted_at?"trash":"inbox")}
                  onRefresh={async()=>{await Promise.all([detail(selected.id),refresh()]);}}
                  onAnalyze={() =>
                    void run("analyze", async () => {
                      await api(
                        "complaints/" + selected.id + "/analyze",
                        "POST",
                        {},
                      );
                      await detail(selected.id);
                    })
                  }
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
                  onVerify={(draft)=>void run('verify',async()=>{
                    await api('complaints/'+selected.id+'/verify-draft','POST',{draft,revision:selected.revision});
                    await detail(selected.id);
                  })}
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
                  <button
                    className="button primary"
                    onClick={() => navigate("intake")}
                  >
                    <Plus size={16} />
                    직접 등록
                  </button>
                </div>
              </div>
              <section className="admin-counters" aria-label="민원 처리 현황" hidden={view==="trash"}>
                {[
                  ["all", "전체 민원"],
                  ["received", "접수 대기"],
                  ["reviewing", "검토 중"],
                  ["waiting", "보완 요청"],
                  ["resolved", "답변 완료"],
                ].map(([s, label]) => (
                  <button
                    key={s}
                    className={applied.status === s ? "active" : ""}
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
                <div className="admin-filter-row second">
                  <label>
                    <span>검색어</span>
                    <input
                      placeholder="민원 제목, 접수번호 또는 발생 위치"
                      value={filter.query}
                      onChange={(e) =>
                        setFilter({ ...filter, query: e.target.value })
                      }
                    />
                  </label>
                  <button className="button primary" type="submit">
                    <Search size={16} />
                    조회
                  </button>
                  <button
                    className="button outline"
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
                        <th>자동 분석</th>
                        <th>근거</th>
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
                              >
                                <small>
                                  {c.id}
                                  {c.is_sample ? <em>가상 사례</em> : null}
                                </small>
                                <strong>{protectedTitle(c)}</strong>
                                {expressionFindings(c).some(f=>f.kind!=='criticism')?<em className="expression-list-flag">주의 표현</em>:null}
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
                            <td>
                              <span
                                className={
                                  "admin-auto-status " +
                                  (c.auto_state || "idle")
                                }
                              >
                                {["queued", "processing"].includes(
                                  c.auto_state || "",
                                ) ? (
                                  <LoaderCircle className="spin" size={12} />
                                ) : null}
                                {autoStates[c.auto_state || "idle"]}
                              </span>
                            </td>
                            <td>
                              {c.evidence ? (
                                <button
                                  className="admin-evidence-link"
                                  onClick={() => open(c.id)}
                                >
                                  {c.evidence.citations.length}건
                                  <ChevronRight size={13} />
                                </button>
                              ) : (
                                <span className="admin-dash">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {!filtered.length ? (
                  <div className="admin-empty">
                    <Inbox size={34} />
                    <h3>
                      {data.complaints.length
                        ? "조회 조건에 맞는 민원이 없습니다."
                        : "접수된 민원이 없습니다."}
                    </h3>
                    <p>
                      {data.complaints.length
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
          ) : view === "intake" ? (
            <Portal
              complaints={data.complaints}
              busy={busy}
              onSelect={open}
              onSubmit={(input) =>
                void run("submit", async () => {
                  const r = await api<{ id: string }>(
                    "complaints",
                    "POST",
                    input,
                  );
                  selectedId.current = r.id;
                  await Promise.all([refresh(), detail(r.id)]);
                  setNotice({
                    message:
                      "민원을 접수했습니다. 법령 검색과 분석이 자동으로 시작됩니다.",
                  });
                })
              }
            />
          ) : (
            <LibraryView
              docs={data.documents}
              ready={data.settings.lawReady}
              busy={busy}
              onSearch={(input) => api("laws/search", "POST", input)}
              onImport={(input) =>
                void run("import", async () => {
                  await api("laws/import", "POST", input);
                  await refresh();
                  setNotice({ message: "공식 법령 자료를 저장했습니다." });
                })
              }
            />
          )}
          <footer className="admin-footer">
            <strong>
              민원쉴드 <span>Shield & Solve</span>
            </strong>
          </footer>
        </main>
      </div>
    </div>
  );
}
