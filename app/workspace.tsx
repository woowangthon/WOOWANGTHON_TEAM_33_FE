"use client";

import {
  useEffect,
  useState,
  useCallback,
  useRef,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ShieldCheck,
  LayoutDashboard,
  Inbox,
  Library,
  ArrowUpRight,
  ChevronLeft,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  CheckCheck,
  Clock3,
  CircleHelp,
  Globe2,
  Phone,
  MapPin,
  CalendarDays,
  ArrowRight,
  LoaderCircle,
  LockKeyhole,
  Eye,
  EyeOff,
  FileText,
  BookOpen,
  RefreshCw,
  X,
  CheckCircle2,
  AlertCircle,
  Menu,
  Send,
  PanelLeftClose,
  Circle,
  Download,
  Trash2,
} from "lucide-react";
import {
  statuses,
  categories,
  type Complaint,
  type Event,
  type AppSettings,
  type LawDocument,
  type Status,
} from "../lib/types";
import { samples } from "../lib/samples";
import CitizenPortal from "./citizen-portal";
import EvidencePanel from "./evidence-panel";
import ExpressionPanel from './expression-panel';
import SupplementPanel from './supplement-panel';
import CitationText from './citation-text';
import DraftReviewPanel from './draft-review-panel';
import CoveragePanel from './coverage-panel';
import RequestTrackingPanel from './request-tracking-panel';
import RecordReportPanel from './record-report-panel';
import {coverageAllowsPublication} from '../lib/coverage';
import { protectedTitle } from '../lib/protection';

type Overview = {
  complaints: Complaint[];
  settings: AppSettings;
  documents: LawDocument[];
  user: { name: string };
};
const defaultSettings: AppSettings = {
  geminiReady: false,
  lawReady: false,
  encryptionReady: false,
  model: "gemini-2.5-flash-lite",
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
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(result.error || "요청을 처리할 수 없습니다.");
  return result;
}
function fmt(date: string, time = false) {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Asia/Seoul",
  }).format(new Date(date));
}
function Badge({ status }: { status: Status }) {
  return (
    <span className={"badge " + status}>
      <i />
      {statuses[status]}
    </span>
  );
}
function Empty({
  icon: Icon = Inbox,
  title,
  children,
  action,
}: {
  icon?: typeof Inbox;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={25} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
function Button({
  children,
  onClick,
  kind = "",
  disabled = false,
  type = "button",
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  kind?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
}) {
  return (
    <button
      type={type}
      className={`button ${kind} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export default function Workspace({
  otherSiteUrl,
}: {
  authenticated: boolean;
  staffSite: boolean;
  otherSiteUrl: string;
}) {
  const [data, setData] = useState<Overview>({
    complaints: [],
    settings: defaultSettings,
    documents: [],
    user: { name: "" },
  });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const next = await api<Overview>("overview");
    setData(next);
    return next;
  }, []);
  useEffect(() => {
    let active = true;
    api<Overview>("overview")
      .then((next) => {
        if (active) setData(next);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(()=>{
    let active=true,inFlight=false;
    const timer=setInterval(async()=>{if(document.hidden||inFlight)return;inFlight=true;try{const next=await api<Overview>('overview?poll=1');if(active)setData(prev=>({...prev,...next}));}catch{}finally{inFlight=false;}},15000);
    return ()=>{active=false;clearInterval(timer);};
  },[]);
  return (
    <CitizenPortal
      authenticated={true}
      aiProviderLabel={data.settings.aiProviderLabel || 'AI 분석 서비스'}
      publicInbox={!!data.settings.publicInbox}
      complaints={data.complaints}
      documents={data.documents}
      loading={loading}
      loadError={error}
      onStaff={() => window.location.assign(otherSiteUrl)}
      onSubmit={async (input) => {
        const result = await api<{ id: string }>("complaints", "POST", input);
        await refresh();
        return result.id;
      }}
      onDetail={(id) =>
        api<{ complaint: Complaint; events: Event[] }>("complaints/" + id)
      }
    />
  );
}

export function ComplaintDetail({
  c,
  events,
  citizen,
  busy,
  ready,
  lawReady,
  onEvidence,
  onBack,
  onAnalyze,
  onUpdate,
  onVerify,
  onRefresh,
}: {
  c: Complaint;
  events: Event[];
  citizen: boolean;
  busy: string;
  ready: boolean;
  lawReady: boolean;
  onEvidence: () => void;
  onBack: () => void;
  onAnalyze: () => void;
  onUpdate: (input: { action: string; [key: string]: unknown }) => void;
  onVerify: (draft:string)=>void;
  onRefresh: ()=>void|Promise<void>;
}) {
  const [original, setOriginal] = useState(false),
    [draft, setDraft] = useState(c.draft),
    [reviewed, setReviewed] = useState(false),
    [tab, setTab] = useState("solve");
  const previousSaved = useRef({ id: c.id, draft: c.draft });
  useEffect(() => {
    const previous = previousSaved.current;
    setDraft((current) =>
      previous.id !== c.id || current === previous.draft ? c.draft : current,
    );
    previousSaved.current = { id: c.id, draft: c.draft };
    setReviewed(false);
  }, [c.id, c.draft]);
  useEffect(() => {
    setOriginal(false);
    setTab("solve");
  }, [c.id]);
  const a = c.analysis;
  const verified=c.auto_state!=='processing'&&c.auto_state!=='queued'&&c.draft_review?.validatorVersion===2&&c.draft_review?.status==='checked'&&c.draft_review.draft===draft.trim()&&c.draft_review.sentences.length>0&&c.draft_review.sentences.every(s=>s.status!=='needs_review')&&coverageAllowsPublication(c.coverage_review,c,draft);
  if(c.deleted_at)return <><button className="back-link" onClick={onBack}>휴지통 목록</button><section className="card panel-padding"><h1>{protectedTitle(c)}</h1><p>{c.id} · 삭제일 {fmt(c.deleted_at,true)}</p><Button kind="primary" disabled={!!busy} onClick={()=>onUpdate({action:'restore'})}>민원 복구</Button></section></>;
  if (citizen)
    return (
      <>
        <button className="back-link" onClick={onBack}>
          목록으로
        </button>
        <section className="card panel-padding">
          <h1>{protectedTitle(c)}</h1>
          <Badge status={c.status} />
          <p className="preserve">{c.body}</p>
          <h2>답변</h2>
          <p className="preserve">{c.published || "답변 대기"}</p>
        </section>
      </>
    );
  return (
    <>
      <button className="back-link" onClick={onBack}>
        <ChevronLeft size={17} />
        민원 목록
      </button>
      <div className="detail-heading">
        <div>
          <div className="detail-meta">
            <span>{c.id}</span>
            <span>{c.category}</span>
            <span>{c.location}</span>
          </div>
          <h1>{protectedTitle(c)}</h1>
        </div>
        <div className="detail-heading-actions"><Badge status={c.status} /><Button kind="outline small danger" disabled={!!busy} onClick={()=>{if(window.confirm('휴지통으로 이동하시겠습니까? 필요하면 다시 복구할 수 있습니다.'))onUpdate({action:'delete'});}}><Trash2 size={15}/>민원 삭제</Button></div>
      </div>
      <div className="detail-grid">
        <div className="detail-main">
          <ExpressionPanel complaint={c}/>
          <section className="card summary-card">
            <div className="detail-tabs">
              <button
                className={tab === "solve" ? "active" : ""}
                onClick={() => setTab("solve")}
              >
                <Sparkles size={16} />
                요약
              </button>
              <button
                className={tab === "original" ? "active" : ""}
                onClick={() => setTab("original")}
              >
                <FileText size={16} />
                원문
              </button>
              <button
                className={tab === "history" ? "active" : ""}
                onClick={() => setTab("history")}
              >
                <Clock3 size={16} />
                처리 이력 <span>{events.length}</span>
              </button>
              {a && tab === "solve" ? (
                <Button
                  kind="quiet small"
                  className="tab-action"
                  onClick={onAnalyze}
                  disabled={!!busy || c.status === "resolved"}
                >
                  <RefreshCw
                    size={14}
                    className={busy === "analyze" ? "spin" : ""}
                  />
                  다시 분석
                </Button>
              ) : null}
            </div>
            {tab === "original" ? (
              <div className="panel-padding">
                {original ? (
                  <div className="original-text"><h4>{c.title}</h4><p>{c.body}</p></div>
                ) : (
                  <div className="protected-placeholder">
                    <ShieldCheck size={26} />
                    <p>민원인의 원문은 기본으로 가려 둡니다.</p>
                  </div>
                )}
                <Button
                  kind="outline small"
                  className="original-toggle"
                  onClick={() => setOriginal(!original)}
                >
                  {original ? <EyeOff size={15} /> : <Eye size={15} />}
                  {original ? "원문 가리기" : "원문 보기"}
                </Button>
              </div>
            ) : tab === "history" ? (
              <div className="panel-padding timeline">
                {events.map((e) => (
                  <div key={e.id}>
                    <span className="timeline-dot" />
                    <strong>{e.label}</strong>
                    <small>{fmt(e.created_at, true)}</small>
                  </div>
                ))}
              </div>
            ) : !a ? (
              <div className="analysis-empty">
                <span className="analysis-orb">
                  <Sparkles size={28} />
                </span>
                <h2>아직 분석 결과가 없습니다</h2>
                <Button
                  kind="primary"
                  onClick={onAnalyze}
                  disabled={!ready || !!busy || c.status === "resolved"}
                >
                  {busy === "analyze" ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <Sparkles size={17} />
                  )}{" "}
                  {busy === "analyze" ? "분석 중…" : "분석 시작"}
                </Button>
              </div>
            ) : (
              <div className="panel-padding analysis-result">
                <p className="summary-box">{a.summary}</p>
                {a.questions.length ? (
                  <div className="summary-questions">
                    <h3>
                      <CircleHelp size={15} />
                      민원인에게 확인할 내용
                    </h3>
                    <ul className="question-list">
                      {a.questions.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {a.warnings.map((w, i) => (
                  <p className="warning-line" key={i}>
                    <AlertCircle size={14} />
                    {w}
                  </p>
                ))}
              </div>
            )}
          </section>
          <RequestTrackingPanel key={'requests:'+c.id} complaint={c} staff onChanged={onRefresh}/>
          <section className="card response-editor">
            <div className="card-header">
              <div>
                <h2>
                  <FileText size={18} />
                  답변 작성
                </h2>
              </div>
            </div>
            <div className="panel-padding">
              <label className="sr-only" htmlFor="reply">
                답변 초안
              </label>
              <textarea
                id="reply"
                rows={9}
                maxLength={10000}
                placeholder="답변 내용을 입력하세요."
                value={draft}
                disabled={c.status === "resolved"}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setReviewed(false);
                }}
              />
              <DraftReviewPanel review={c.draft_review} draft={draft} citations={c.evidence?.citations||c.analysis?.citations||[]} busy={!!busy} completed={c.status==='resolved'} onVerify={()=>onVerify(draft)}/>
              {c.status === "resolved" ? (
                <div className="approved-banner">
                  <CheckCircle2 size={19} />
                  검토한 답변이 민원인 화면에 등록되었습니다.
                </div>
              ) : (
                <>
                  <label className="checkbox-label review-confirm">
                    <input
                      type="checkbox"
                      checked={reviewed}
                      onChange={(e) => setReviewed(e.target.checked)}
                    />
                    사실관계와 법령 근거를 확인했습니다.
                  </label>
                  <div className="editor-actions">
                    <span>{draft.length.toLocaleString()} / 10,000</span>
                    <Button
                      kind="outline"
                      disabled={!!busy}
                      onClick={() => onUpdate({ action: "save", draft })}
                    >
                      초안 저장
                    </Button>
                    <Button
                      kind="primary"
                      disabled={!!busy || !reviewed || !verified || draft.trim().length < 10}
                      onClick={() =>
                        onUpdate({ action: "approve", draft, reviewed })
                      }
                    >
                      <CheckCheck size={17} />
                      승인하고 답변 등록
                    </Button>
                  </div>
                </>
              )}
            </div>
          </section>
          <CoveragePanel key={c.id} complaint={c} draft={draft} busy={!!busy} onVerify={()=>onVerify(draft)} onChanged={onRefresh}/>
          <EvidencePanel
            evidence={c.evidence}
            cited={a?.citations || []}
            ready={lawReady}
            busy={!!busy}
            completed={c.status === "resolved"}
            onSearch={onEvidence}
          />
        </div>
        <aside className="detail-aside">
          <section className="card status-panel">
            <h3>처리 현황</h3>
            <label htmlFor="status">현재 상태</label>
            <select
              id="status"
              value={c.status}
              disabled={!!busy || c.status === "resolved"}
              onChange={(e) =>
                onUpdate({ action: "status", status: e.target.value })
              }
            >
              {Object.entries(statuses).map(([key, label]) => (
                <option key={key} value={key} disabled={key === "resolved" || key === "waiting"}>
                  {label}
                </option>
              ))}
            </select>
            <dl>
              <div>
                <dt>접수 채널</dt>
                <dd>
                  {c.channel==='phone'?<Phone size={13}/>:<Globe2 size={13}/>}
                  {c.channel==='phone'?'음성 상담':'홈페이지'}
                </dd>
              </div>
              <div>
                <dt>접수일</dt>
                <dd>{fmt(c.created_at, true)}</dd>
              </div>
              <div>
                <dt>관할</dt>
                <dd>청주시</dd>
              </div>
            </dl>
          </section>
          <section className="card task-panel">
            <div className="section-heading">
              <h3>후속 조치</h3>
              <span>
                {c.tasks.filter((t) => t.done).length}/{c.tasks.length}
              </span>
            </div>
            {c.tasks.length ? (
              c.tasks.map((t) => (
                <label
                  key={t.id}
                  className={"task-item " + (t.done ? "done" : "")}
                >
                  <input
                    type="checkbox"
                    checked={t.done}
                    disabled={!!busy}
                    onChange={(e) =>
                      onUpdate({
                        action: "tasks",
                        tasks: c.tasks.map((x) =>
                          x.id === t.id ? { ...x, done: e.target.checked } : x,
                        ),
                      })
                    }
                  />
                  <span>{t.label}</span>
                </label>
              ))
            ) : (
              <p className="muted-text">등록된 후속 조치가 없습니다.</p>
            )}
          </section>
          <SupplementPanel complaint={c} staff onChanged={onRefresh}/>
          <RecordReportPanel key={c.id+':'+(c.analysis?.generatedAt||'')} complaint={c} busy={!!busy}/>
        </aside>
      </div>
    </>
  );
}

export function Portal({
  complaints,
  busy,
  onSelect,
  onSubmit,
}: {
  complaints: Complaint[];
  busy: string;
  onSelect: (id: string) => void;
  onSubmit: (input: unknown) => void;
}) {
  const [title, setTitle] = useState(""),
    [body, setBody] = useState(""),
    [category, setCategory] = useState<string>(categories[0]),
    [location, setLocation] = useState(""),
    [date, setDate] = useState(new Date().toISOString().slice(0, 10)),
    [consent, setConsent] = useState(false);
  const fillSample = () => {
    const s = samples[0];
    setTitle(s.title);
    setBody(s.body);
    setCategory(s.category);
    setLocation(s.location);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({ title, body, category, location, occurredAt: date, consent });
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>민원 직접 등록</h1>
        </div>
      </div>
      <div className="portal-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <h2>새 민원 접수</h2>
            </div>
            <Button kind="outline small" onClick={fillSample}>
              예시 채우기
            </Button>
          </div>
          <form className="form-body" onSubmit={submit}>
            <div className="form-row">
              <label>
                민원 유형
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  {categories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                발생일
                <input
                  type="date"
                  value={date}
                  max={new Date().toISOString().slice(0, 10)}
                  required
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            </div>
            <label>
              민원 제목
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                minLength={3}
                maxLength={120}
                placeholder="어떤 불편이 있으신가요?"
                required
              />
            </label>
            <label>
              발생 위치
              <input
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                minLength={2}
                maxLength={200}
                placeholder="예: 청주시 흥덕구 가상로 12 앞 골목"
                required
              />
            </label>
            <label>
              민원 내용
              <textarea
                rows={8}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                minLength={10}
                maxLength={6000}
                placeholder="언제, 어디서, 어떤 일이 있었는지와 원하시는 조치를 알려주세요."
                required
              />
              <span className="field-help">
                이름·전화번호·주민등록번호 등 개인정보는 입력하지 마세요.{" "}
                <span>{body.length}/6,000</span>
              </span>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                required
              />
              민원 내용 저장 및 AI 분석에 동의합니다.
            </label>
            <div className="submit-row">
              <Button
                type="submit"
                kind="primary"
                disabled={!!busy || !consent}
              >
                {busy === "submit" ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <Send size={16} />
                )}
                민원 접수하기
              </Button>
            </div>
          </form>
        </section>
        <div>
          <section className="card my-complaints">
            <div className="card-header">
              <h2>내 민원 조회</h2>
              <span>{complaints.length}건</span>
            </div>
            {complaints.length ? (
              <div className="portal-list">
                {complaints.slice(0, 10).map((c) => (
                  <button key={c.id} onClick={() => onSelect(c.id)}>
                    <div>
                      <small>{c.id}</small>
                      <strong>{protectedTitle(c)}</strong>
                    </div>
                    <Badge status={c.status} />
                  </button>
                ))}
              </div>
            ) : (
              <Empty icon={FileText} title="접수한 민원이 없습니다">
                등록한 민원과 답변을 이곳에서 확인할 수 있어요.
              </Empty>
            )}
          </section>
        </div>
      </div>
    </>
  );
}

export function LibraryView({
  docs,
  ready,
  busy,
  onSearch,
  onImport,
}: {
  docs: LawDocument[];
  ready: boolean;
  busy: string;
  onSearch: (input: unknown) => Promise<{
    results: {
      id: string;
      title: string;
      kind: string;
      effectiveDate: string;
      jurisdiction: string;
    }[];
  }>;
  onImport: (input: unknown) => void;
}) {
  const [query, setQuery] = useState("청주시 폐기물 관리"),
    [kind, setKind] = useState("ordin"),
    [searching, setSearching] = useState(false),
    [results, setResults] = useState<
      | {
          id: string;
          title: string;
          kind: string;
          effectiveDate: string;
          jurisdiction: string;
        }[]
      | null
    >(null),
    [error, setError] = useState("");
  const search = async (e: FormEvent) => {
    e.preventDefault();
    setSearching(true);
    setError("");
    setResults(null);
    try {
      const r = await onSearch({ query, kind });
      setResults(r.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : "검색 실패");
    } finally {
      setSearching(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>법령·조례 자료실</h1>
        </div>
      </div>

      <section className="card law-search">
        <div className="card-header">
          <h2>공식 법령 검색·가져오기</h2>
          <span className="source-tag">SOURCE · 국가법령정보센터</span>
        </div>
        {!ready ? (
          <p className="panel-padding muted-text">현재 법령 검색을 사용할 수 없습니다.</p>
        ) : (
          <form onSubmit={search} className="law-search-form">
            <select
              aria-label="법령 구분"
              value={kind}
              onChange={(e) => {
                setKind(e.target.value);
                setResults(null);
                setQuery(
                  e.target.value === "law"
                    ? "폐기물관리법"
                    : "청주시 폐기물 관리",
                );
              }}
            >
              <option value="ordin">청주시 자치법규</option>
              <option value="law">전국 법령</option>
            </select>
            <label className="search-field">
              <Search size={18} />
              <input
                aria-label="법령명"
                placeholder="법령 또는 조례 이름을 입력하세요"
                value={query}
                minLength={2}
                maxLength={100}
                required
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <Button kind="primary" type="submit" disabled={searching}>
              {searching ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Search size={16} />
              )}
              검색
            </Button>
          </form>
        )}
        {error ? (
          <p className="inline-error" role="alert">
            {error}
          </p>
        ) : null}
        {results ? (
          <div className="law-results">
            {results.length ? (
              results.map((r) => (
                <div key={r.kind + r.id}>
                  <BookOpen size={18} />
                  <div>
                    <strong>{r.title}</strong>
                    <small>
                      시행 {r.effectiveDate || "본문에서 확인"} ·{" "}
                      {r.jurisdiction}
                    </small>
                  </div>
                  <Button
                    kind="outline small"
                    disabled={!!busy}
                    onClick={() => onImport({ id: r.id, kind: r.kind })}
                  >
                    <Plus size={14} />
                    가져오기
                  </Button>
                </div>
              ))
            ) : (
              <p>일치하는 공식 자료가 없습니다. 검색어를 바꿔 주세요.</p>
            )}
          </div>
        ) : null}
      </section>
      <section className="card library-docs">
        <div className="card-header">
          <div>
            <h2>
              내 검색 자료 <span>{docs.length}</span>
            </h2>
          </div>
          <span className="count-label">
            {docs.reduce((n, d) => n + d.articleCount, 0)}개 조문
          </span>
        </div>
        {docs.length ? (
          <div className="document-list">
            {docs.map((d) => (
              <article key={d.id}>
                <span
                  className={
                    "document-icon " + (d.kind === "law" ? "blue" : "green")
                  }
                >
                  <BookOpen size={23} />
                </span>
                <div>
                  <span className="row-meta">
                    {d.kind === "law" ? "법령" : "자치법규"}
                    <b>·</b>
                    {d.jurisdiction}
                  </span>
                  <h3>{d.title}</h3>
                  <p>
                    시행일 {d.effective_date} · {d.articleCount}개 조문 ·{" "}
                    {fmt(d.imported_at)} 동기화
                  </p>
                </div>
                <a
                  className="icon-button"
                  href={d.source_url}
                  aria-label={d.title + " 공식 원문"}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ArrowUpRight size={18} />
                </a>
              </article>
            ))}
          </div>
        ) : (
          <Empty icon={Library} title="저장된 법령 자료가 없습니다.">{null}</Empty>
        )}
      </section>
    </>
  );
}
