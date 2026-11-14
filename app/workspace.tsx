"use client";

import {
  AlertCircle,
  CheckCheck,
  CheckCircle2,
  ChevronLeft,
  Globe2,
  LoaderCircle,
  Phone,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { protectedTitle } from '../lib/protection';
import {
  statuses,
  type AppSettings,
  type Complaint,
  type Event,
  type LawDocument,
  type Status,
} from "../lib/types";
import CitizenPortal from "./citizen-portal";
import EvidencePanel from "./evidence-panel";
import ExpressionPanel from './expression-panel';
import RecordReportPanel from './record-report-panel';
import TaskPanel from './task-panel';
import type { TaskSnapshot } from '../lib/task-save-queue';
import { summarizeHistory } from '../lib/task-history';

type Overview = {
  complaints: Complaint[];
  settings: AppSettings;
  documents: LawDocument[];
  user: { name: string };
};
const defaultSettings: AppSettings = {
  aiReady: false,
  lawReady: false,
  encryptionReady: false,
  model: "gpt-6-luna",
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
  lawReady,
  onEvidence,
  onBack,
  onUpdate,
  onTasksSaved,
  onTasksPending,
  onTasksError,
}: {
  c: Complaint;
  events: Event[];
  citizen: boolean;
  busy: string;
  lawReady: boolean;
  onEvidence: () => void;
  onBack: () => void;
  onUpdate: (input: { action: string; [key: string]: unknown }) => void;
  onTasksSaved:(snapshot:TaskSnapshot)=>void;
  onTasksPending:(pending:boolean)=>void;
  onTasksError:(message:string)=>void;
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
  const history=summarizeHistory(events);
  const analyzing=c.auto_state==='processing'||c.auto_state==='queued';
  if(c.deleted_at)return <><button className="back-link" onClick={onBack}>휴지통 목록</button><section className="card panel-padding"><h1>{protectedTitle(c)}</h1><p>{c.id} · 삭제일 {fmt(c.deleted_at,true)}</p><Button kind="primary" disabled={!!busy} onClick={()=>onUpdate({action:'restore'})}>민원 복구</Button></section></>;
  if (citizen)
    return (
      <>
        <button className="back-link" onClick={onBack}>
          목록으로
        </button>
        <section className="card panel-padding">
          <h1>{protectedTitle(c)}</h1>
          {c.source_data?<p className="data-source">공개 데이터 검증 · <a href={c.source_data.url} target="_blank" rel="noreferrer">{c.source_data.provider} · {c.source_data.recordId}</a></p>:null}
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
                요약
              </button>
              <button
                className={tab === "original" ? "active" : ""}
                onClick={() => setTab("original")}
              >
                원문
              </button>
              <button
                className={tab === "history" ? "active" : ""}
                onClick={() => setTab("history")}
              >
                처리 이력 <span>{history.length}</span>
              </button>
            </div>
            {tab === "original" ? (
              <div className="panel-padding">
                {original ? (
                  <div className="original-text"><h4>{c.title}</h4><p>{c.body}</p></div>
                ) : null}
                <Button
                  kind="outline small"
                  className="original-toggle"
                  onClick={() => setOriginal(!original)}
                >
                  {original ? "원문 가리기" : "원문 보기"}
                </Button>
              </div>
            ) : tab === "history" ? (
              <div className="panel-padding timeline">
                {history.map((e) => (
                  <div key={e.id}>
                    <strong className="preserve">{e.label}</strong>
                    <small>{fmt(e.created_at, true)}</small>
                  </div>
                ))}
              </div>
            ) : !a ? (
              <div className="panel-padding" role="status" aria-live="polite">
                {c.auto_state === 'failed' ? '요약을 생성하지 못했습니다.' :
                  c.status === 'resolved' || c.auto_state === 'completed' ? '저장된 요약이 없습니다.' :
                  c.auto_state === 'blocked' ? '분석 서비스 연결을 확인해 주세요.' :
                  '요약을 자동으로 생성하고 있습니다.'}
              </div>
            ) : (
              <div className="panel-padding analysis-result">
                <p className="summary-box">{a.summary}</p>
                {a.warnings.map((w, i) => (
                  <p className="warning-line" key={i}>
                    <AlertCircle size={14} />
                    {w}
                  </p>
                ))}
              </div>
            )}
          </section>
          <section className="card response-editor">
            <div className="card-header">
              <div>
                <h2>
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
                      disabled={!!busy || !reviewed || analyzing || draft.trim().length < 10}
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
                <option key={key} value={key} disabled={key === "resolved"}>
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
          <TaskPanel key={c.id} complaint={c} disabled={!!busy && busy!=="tasks"} onSaved={onTasksSaved} onPending={onTasksPending} onError={onTasksError}/>
          <RecordReportPanel key={c.id+':'+(c.analysis?.generatedAt||'')} complaint={c} busy={!!busy}/>
        </aside>
      </div>
    </>
  );
}
