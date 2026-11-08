"use client";
import SupplementPanel from './supplement-panel';
import RequestTrackingPanel from './request-tracking-panel';
import CitationText from './citation-text';
import { protectedTitle } from '../lib/protection';

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FilePenLine,
  FileText,
  HelpCircle,
  Home,
  Leaf,
  LoaderCircle,
  LogIn,
  MapPin,
  Menu,
  MonitorCheck,
  Pause,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  TrafficCone,
  Trash2,
  UserRound,
  Volume2,
  X,
} from "lucide-react";
import {
  categories,
  statuses,
  type Complaint,
  type Event,
  type LawDocument,
  type Status,
} from "../lib/types";

type Section = "home" | "apply" | "my" | "guide" | "laws" | "help" | "privacy";
type Input = {
  title: string;
  body: string;
  category: string;
  location: string;
  occurredAt: string;
  consent: boolean;
};
type Props = {
  authenticated: boolean;
  aiProviderLabel: string;
  publicInbox: boolean;
  complaints: Complaint[];
  documents: LawDocument[];
  loading: boolean;
  loadError?: string;
  onStaff: () => void;
  onSubmit: (input: Input) => Promise<string>;
  onDetail: (id: string) => Promise<{ complaint: Complaint; events: Event[] }>;
};
const sectionTitles: Record<Section, string> = {
  home: "홈",
  apply: "민원 신청",
  my: "나의 민원",
  guide: "민원 처리 안내",
  laws: "법령·조례 안내",
  help: "도움말",
  privacy: "개인정보 처리 안내",
};
const guides = [
  {
    q: "민원은 어떻게 신청하나요?",
    a: "민원 신청에서 이용 안내를 확인한 후, 제목·발생 장소·내용을 작성해 주세요. 제출 전 내용을 다시 확인할 수 있으며, 접수 후 나의 민원에서 처리 상태와 답변을 확인할 수 있습니다.",
  },
  {
    q: "접수한 민원은 어디에서 확인하나요?",
    a: "이 브라우저에서 접수한 민원은 나의 민원에서 확인할 수 있습니다. 접수번호나 제목으로 검색하고 접수·검토 중·보완 요청·답변 완료 상태별로 조회할 수 있습니다.",
  },
  {
    q: "법령과 조례의 근거는 어떻게 확인하나요?",
    a: "담당자가 공식 법령 데이터를 연결하면 민원 내용에 따라 관련 조문을 검색합니다. 확인된 근거에는 조문과 시행일, 공식 원문 링크가 제공됩니다. 근거를 찾지 못하면 확인이 필요하다고 표시합니다.",
  },
];

function date(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul",
  }).format(new Date(value));
}
function StatusTag({ status }: { status: Status }) {
  return <span className={"cp-status " + status}>{statuses[status]}</span>;
}
function Brand() {
  return (
    <>
      <span className="cp-brand-symbol">
        <ShieldCheck size={38} strokeWidth={1.8} />
      </span>
      <span>
        <strong>
          민원<span>쉴드</span>
        </strong>
      </span>
    </>
  );
}

export default function CitizenPortal({
  authenticated,
  aiProviderLabel,
  publicInbox,
  complaints,
  documents,
  loading,
  loadError,
  onStaff,
  onSubmit,
  onDetail,
}: Props) {
  const [section, setSection] = useState<Section>("home"),
    [mobile, setMobile] = useState(false),
    [query, setQuery] = useState(""),
    [searchText, setSearchText] = useState(""),
    [applyKey, setApplyKey] = useState(0);
  const [detail, setDetail] = useState<Complaint | null>(null),
    [events, setEvents] = useState<Event[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const request = useRef(0),
    activeSection = useRef<Section>("home");
  useEffect(() => {
    const sync = () => {
      const raw = window.location.hash.slice(1);
      if (raw && !Object.hasOwn(sectionTitles, raw)) return;
      const next = (
        Object.hasOwn(sectionTitles, raw) ? raw : "home"
      ) as Section;
      if (activeSection.current === next) return;
      activeSection.current = next;
      setSection(next);
      setDetail(null);
      setError("");
      setMobile(false);
      setBusy(false);
      request.current++;
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const detailId=detail?.id;
  useEffect(()=>{
    if(!detailId)return;
    let active=true,inFlight=false;
    const timer=setInterval(async()=>{if(document.hidden||inFlight)return;inFlight=true;try{const response=await fetch('/api/complaints/'+detailId);if(!response.ok)return;const d=await response.json();if(active){setDetail(d.complaint);setEvents(d.events);}}catch{}finally{inFlight=false;}},15000);
    return ()=>{active=false;clearInterval(timer);};
  },[detailId]);
  const go = (next: Section) => {
    request.current++;
    activeSection.current = next;
    setBusy(false);
    setSection(next);
    if (next === "apply") setApplyKey((k) => k + 1);
    setDetail(null);
    setError("");
    setMobile(false);
    window.location.hash = next;
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const search = (e: FormEvent) => {
    e.preventDefault();
    setQuery(searchText.trim());
    go("my");
  };
  const open = async (id: string) => {
    const token = ++request.current;
    setBusy(true);
    setError("");
    try {
      const d = await onDetail(id);
      if (token !== request.current) return;
      setDetail(d.complaint);
      setEvents(d.events);
      window.scrollTo(0, 0);
    } catch (e) {
      if (token === request.current)
        setError(
          e instanceof Error ? e.message : "민원을 불러오지 못했습니다.",
        );
    } finally {
      if (token === request.current) setBusy(false);
    }
  };
  return (
    <div className="citizen-site">
      <a className="cp-skip" href="#citizen-main">
        본문 바로가기
      </a>

      <header className="cp-header">
        <div className="cp-container cp-header-inner">
          <button
            className="cp-brand"
            onClick={() => go("home")}
            aria-label="민원 쉴드 홈"
          >
            <Brand />
          </button>
          <div className="cp-header-right">
            <div className="cp-utility">
              <button onClick={() => go("guide")}>
                이용 안내 <ChevronRight size={13} />
              </button>
              <span />
              <button onClick={() => go("my")}>나의 민원</button>
              <span />
              <button onClick={onStaff}>
                담당자 업무 <ArrowUpRight size={13} />
              </button>
            </div>
            <div className="cp-header-actions">
              <form className="cp-header-search" onSubmit={search}>
                <label htmlFor="header-search" className="sr-only">
                  나의 민원 검색
                </label>
                <input
                  id="header-search"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  placeholder="나의 민원 검색"
                />
                <button aria-label="민원 검색">
                  <Search size={23} />
                </button>
              </form>
              <button className="cp-account" onClick={() => go("my")}>
                <UserRound size={21} />
                나의 민원
              </button>
              <button
                className="cp-mobile-toggle"
                aria-label={mobile ? "전체 메뉴 닫기" : "전체 메뉴 열기"}
                aria-expanded={mobile}
                onClick={() => setMobile(!mobile)}
              >
                {mobile ? <X /> : <Menu />}
              </button>
            </div>
          </div>
        </div>
      </header>
      <nav
        className={"cp-nav " + (mobile ? "is-open" : "")}
        aria-label="주 메뉴"
      >
        <div className="cp-container">
          {(["apply", "my", "guide", "laws", "help"] as Section[]).map((s) => (
            <button
              key={s}
              className={section === s ? "active" : ""}
              aria-current={section === s ? "page" : undefined}
              onClick={() => {
                if (s === "my") setQuery("");
                go(s);
              }}
            >
              {sectionTitles[s]}
              <ChevronDown size={16} />
            </button>
          ))}
          <a href="/phone" style={{display:'flex',alignItems:'center',padding:'0 20px',fontWeight:600}}>음성 상담</a>
          <button className="cp-staff-nav" onClick={onStaff}>
            <ShieldCheck size={19} />
            담당자 업무
            <ArrowUpRight size={16} />
          </button>
        </div>
      </nav>
      <main id="citizen-main">
        {section === "home" ? (
          <>
            <section className="cp-hero">
              <div className="cp-container cp-hero-inner">
                <div className="cp-hero-copy">
                  <h1>민원 신청·조회</h1>
                  <form className="cp-hero-search" onSubmit={search}>
                    <label htmlFor="hero-search">나의 민원검색</label>
                    <input
                      id="hero-search"
                      value={searchText}
                      onChange={(e) => setSearchText(e.target.value)}
                      placeholder="접수번호 또는 민원 제목을 입력해 주세요."
                    />
                    <button aria-label="나의 민원 검색하기">
                      <Search size={34} />
                    </button>
                  </form>
                </div>
              </div>
            </section>
            <div className="cp-container">
              <section
                className="cp-quick-grid"
                aria-label="민원 서비스 바로가기"
              >
                {[
                  {
                    title: "민원 신청",
                    desc: "생활 속 불편을 알려주세요",
                    icon: FilePenLine,
                    to: "apply",
                  },
                  {
                    title: "민원 처리 안내",
                    desc: "신청 전 궁금한 점을 확인하세요",
                    icon: ClipboardCheck,
                    to: "guide",
                  },
                  {
                    title: "법령·조례 안내",
                    desc: "정확한 근거를 확인하세요",
                    icon: BookOpen,
                    to: "laws",
                  },
                  {
                    title: "나의 민원 조회",
                    desc: "처리 상황과 답변을 확인하세요",
                    icon: MonitorCheck,
                    to: "my",
                  },
                ].map((s, i) => (
                  <button
                    key={s.to}
                    className={"cp-quick cp-quick-" + i}
                    onClick={() => {
                      setQuery("");
                      go(s.to as Section);
                    }}
                  >
                    <s.icon size={57} strokeWidth={1.4} />
                    <div>
                      <h2>{s.title}</h2>
                    </div>
                    <ArrowRight className="cp-quick-arrow" size={21} />
                  </button>
                ))}
              </section>
              <section className="cp-services">
                <div className="cp-service-list">
                  <h2>분야별 민원 신청</h2>
                  <div className="cp-category-grid">
                    {[
                      {
                        name: "생활폐기물",
                        desc: "쓰레기·배출·수거",
                        icon: Trash2,
                      },
                      {
                        name: "소음·환경",
                        desc: "생활 소음·환경 불편",
                        icon: Volume2,
                      },
                      {
                        name: "도로·교통",
                        desc: "도로·보행로 불편",
                        icon: TrafficCone,
                      },
                      {
                        name: "건축·주거",
                        desc: "건축·공동주택·층간소음",
                        icon: Home,
                      },
                      {
                        name: "동물·공원",
                        desc: "반려동물·공원 시설",
                        icon: Leaf,
                      },
                      {
                        name: "기타",
                        desc: "그 밖의 생활 민원",
                        icon: FileText,
                      },
                    ].map((c) => (
                      <button
                        key={c.name}
                        onClick={() => {
                          sessionStorage.setItem("shield-category", c.name);
                          go("apply");
                        }}
                      >
                        <c.icon size={35} strokeWidth={1.5} />
                        <span>
                          <strong>{c.name}</strong>
                          <small>{c.desc}</small>
                        </span>
                        <ChevronRight size={17} />
                      </button>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </>
        ) : (
          <>
            <div className="cp-sub-band">
              <div className="cp-container">
                <button onClick={() => go("home")} aria-label="홈">
                  <Home size={16} />
                </button>
                <ChevronRight size={13} />
                <span>{sectionTitles[section]}</span>
              </div>
            </div>
            <div className="cp-container cp-page-layout">
              <aside className="cp-side-menu">
                <h2>민원 서비스</h2>
                {(["apply", "my", "guide", "laws", "help"] as Section[]).map(
                  (s) => (
                    <button
                      key={s}
                      className={section === s ? "active" : ""}
                      onClick={() => go(s)}
                    >
                      {sectionTitles[s]}
                      <ChevronRight size={17} />
                    </button>
                  ),
                )}
              </aside>
              <div className="cp-page-content">
                <div className="cp-page-title">
                  <h1>{sectionTitles[section]}</h1>
                </div>
                {error || loadError ? (
                  <div className="cp-error" role="alert">
                    {error || loadError}
                  </div>
                ) : null}
                {section === "apply" ? (
                  <ApplicationForm
                    key={applyKey}
                    aiProviderLabel={aiProviderLabel}
                    publicInbox={publicInbox}
                    onSubmit={onSubmit}
                    onComplete={(id) => {
                      go("my");
                      void open(id);
                    }}
                  />
                ) : section === "my" ? (
                  loading ? (
                    <div className="cp-empty">
                      <LoaderCircle className="spin" />
                      <p>민원을 불러오고 있습니다.</p>
                    </div>
                  ) : detail ? (
                    <CitizenDetail
                      onRefresh={()=>open(detail.id)}
                      complaint={detail}
                      events={events}
                      onBack={() => setDetail(null)}
                    />
                  ) : (
                    <MyComplaints
                      complaints={complaints}
                      initialQuery={query}
                      busy={busy}
                      onSelect={open}
                      onApply={() => go("apply")}
                    />
                  )
                ) : section === "guide" ? (
                  <Guide onApply={() => go("apply")} />
                ) : section === "laws" ? (
                  <Laws documents={documents} />
                ) : section === "privacy" ? (
                  <div className="cp-prose">
                    <h2>개인정보 처리 안내</h2>
                    <p>
                      민원 내역은 서버에 저장됩니다. 나의 민원 조회에는 이 브라우저의 쿠키를 사용합니다.
                      쿠키를 삭제하거나 다른 브라우저를 사용하면 나의 민원 내역을 조회할 수 없습니다.
                    </p>
                    {publicInbox?<p>접수 내용, 분석 결과와 처리 기록은 로그인 없이 열리는 공개 업무 접수함에 표시됩니다.</p>:null}
                    <h3>AI 분석에 사용되는 정보</h3>
                    <p>
                      민원 자동 분석을 위해 민원 내용과 검색한 법령 근거를
                      {aiProviderLabel}로 전송합니다.
                    </p>
                  </div>
                ) : (
                  <>
                    <h2 className="cp-faq-heading">자주 묻는 질문</h2>
                    <div className="cp-faq-list">
                      {guides.map((g) => (
                        <details key={g.q}>
                          <summary>
                            <b>Q</b>
                            {g.q}
                            <ChevronDown size={18} />
                          </summary>
                          <p>{g.a}</p>
                        </details>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </main>
      <footer className="cp-footer">
        <div className="cp-container">
          <div className="cp-footer-links">
            <button onClick={() => go("privacy")}>개인정보 처리 안내</button>
            <button onClick={() => go("guide")}>이용 안내</button>
            <button onClick={() => go("help")}>자주 묻는 질문</button>
            <button onClick={onStaff}>담당자 업무</button>
            <a
              href="https://www.epeople.go.kr/index.jsp"
              target="_blank"
              rel="noreferrer"
            >
              국민신문고 <ArrowUpRight size={14} />
            </a>
          </div>
          <div className="cp-footer-main">
            <button
              className="cp-brand"
              onClick={() => go("home")}
              aria-label="민원 쉴드 홈"
            >
              <Brand />
            </button>
            <div>
              <strong>민원 쉴드 · Shield & Solve</strong>
            </div>
            <button
              className="cp-to-top"
              onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
              aria-label="맨 위로"
            >
              ↑<span>TOP</span>
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function ApplicationForm({
  onSubmit,
  onComplete,
  aiProviderLabel,
  publicInbox,
}: {
  aiProviderLabel: string;
  publicInbox: boolean;
  onSubmit: Props["onSubmit"];
  onComplete: (id: string) => void;
}) {
  const [step, setStep] = useState(0),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [id, setId] = useState("");
  const [input, setInput] = useState({
    title: "",
    body: "",
    category: "생활폐기물",
    location: "",
    occurredAt: "",
  });
  useEffect(() => {
    const c = sessionStorage.getItem("shield-category");
    if (c && categories.includes(c as (typeof categories)[number]))
      setInput((v) => ({ ...v, category: c }));
    sessionStorage.removeItem("shield-category");
  }, []);
  const change = (key: keyof typeof input, value: string) =>
    setInput((v) => ({ ...v, [key]: value }));
  const next = (e: FormEvent) => {
    e.preventDefault();
    setStep(2);
    setError("");
    window.scrollTo(0, 160);
  };
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      setId(await onSubmit({ ...input, consent }));
      setStep(3);
      window.scrollTo(0, 160);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "접수하지 못했습니다. 다시 시도해 주세요.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ol className="cp-form-steps" aria-label="민원 신청 단계">
        {["이용 안내", "민원 작성", "내용 확인", "접수 완료"].map((s, i) => (
          <li
            key={s}
            className={i === step ? "active" : i < step ? "done" : ""}
            aria-current={i === step ? "step" : undefined}
          >
            <span>{i < step ? <Check size={18} /> : i + 1}</span>
            <strong>{s}</strong>
          </li>
        ))}
      </ol>
      {error ? (
        <div role="alert" className="cp-error">
          {error}
        </div>
      ) : null}
      {step === 0 ? (
        <>
          <div className="cp-guide-box">
            <ShieldCheck size={33} />
            <div>
              <h2>민원 신청</h2>
            </div>
          </div>
          <section className="cp-form-section">
            <h2>민원 신청 안내</h2>
            <ul className="cp-bullets">
              <li>
                발생 장소, 시간, 불편 사항과 요청 내용을 구체적으로 작성해
                주세요.
              </li>
              <li>신청한 내용은 나의 민원에서 확인할 수 있습니다.</li>
              <li>담당자가 검토하고 승인한 답변만 등록됩니다.</li>
            </ul>
            <div className="cp-consent-box">
              <h3>민원 내용 처리 동의</h3>
              <p>
                입력한 민원 내용은 저장되며, 자동 분석을 위해 {aiProviderLabel}로
                전송됩니다.
              </p>
              {publicInbox?<p>접수 내용과 처리 기록은 공개 업무 접수함에 표시됩니다.</p>:null}
              <label>
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                민원 내용 저장{publicInbox?'·공개':''} 및 AI 분석에 동의합니다.
              </label>
            </div>
          </section>
          <div className="cp-form-actions">
            <button
              className="cp-btn primary"
              disabled={!consent}
              onClick={() => {
                setStep(1);
                window.scrollTo(0, 160);
              }}
            >
              민원 작성하기
              <ArrowRight size={18} />
            </button>
          </div>
        </>
      ) : step === 1 ? (
        <form onSubmit={next}>
          <div className="cp-section-heading">
            <h2>민원 내용 작성</h2>
            <span>
              <b className="cp-required">*</b> 필수 입력 항목
            </span>
          </div>
          <div className="cp-fields">
            <label>
              <span>
                민원 분야 <b>*</b>
              </span>
              <select
                required
                value={input.category}
                onChange={(e) => change("category", e.target.value)}
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              <span>
                민원 제목 <b>*</b>
              </span>
              <input
                required
                minLength={3}
                maxLength={120}
                value={input.title}
                onChange={(e) => change("title", e.target.value)}
                placeholder="민원 내용을 간략하게 작성해 주세요."
              />
            </label>
            <label>
              <span>
                발생 장소 <b>*</b>
              </span>
              <input
                required
                minLength={2}
                maxLength={200}
                value={input.location}
                onChange={(e) => change("location", e.target.value)}
                placeholder="예: 청주시 가상동 공원 입구"
              />
            </label>
            <label>
              <span>
                발생 일자 <b>*</b>
              </span>
              <input
                required
                type="date"
                value={input.occurredAt}
                max={new Date().toLocaleDateString("en-CA", {
                  timeZone: "Asia/Seoul",
                })}
                onChange={(e) => change("occurredAt", e.target.value)}
              />
            </label>
            <label className="cp-body-field">
              <span>
                민원 내용 <b>*</b>
              </span>
              <div>
                <textarea
                  required
                  minLength={10}
                  maxLength={6000}
                  rows={10}
                  value={input.body}
                  onChange={(e) => change("body", e.target.value)}
                  placeholder={"언제, 어디에서, 어떤 불편이 있었나요?\n확인 또는 조치가 필요한 내용을 구체적으로 알려주세요."}
                />
                <small>
                  개인정보를 포함하지 않도록 확인해 주세요.
                  <span>{input.body.length.toLocaleString()} / 6,000자</span>
                </small>
              </div>
            </label>
          </div>
          <div className="cp-form-actions">
            <button type="button" className="cp-btn" onClick={() => setStep(0)}>
              <ChevronLeft size={18} />
              이전
            </button>
            <button className="cp-btn primary" type="submit">
              내용 확인
              <ChevronRight size={18} />
            </button>
          </div>
        </form>
      ) : step === 2 ? (
        <>
          <div className="cp-section-heading">
            <h2>제출할 내용을 확인해 주세요</h2>
          </div>
          <dl className="cp-summary-table">
            {[
              ["민원 분야", input.category],
              ["민원 제목", input.title],
              ["발생 장소", input.location],
              ["발생 일자", input.occurredAt],
              ["민원 내용", input.body],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>

          <div className="cp-form-actions">
            <button
              className="cp-btn"
              disabled={busy}
              onClick={() => setStep(1)}
            >
              수정하기
            </button>
            <button className="cp-btn primary" disabled={busy} onClick={submit}>
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <ClipboardCheck size={18} />
              )}{" "}
              {busy ? "접수 중…" : "민원 접수하기"}
            </button>
          </div>
        </>
      ) : (
        <div className="cp-complete">
          <CheckCircle2 size={68} strokeWidth={1.5} />
          <h2>민원이 접수되었습니다.</h2>

          <div>
            <span>접수번호</span>
            <strong>{id}</strong>
          </div>

          <button className="cp-btn primary" onClick={() => onComplete(id)}>
            접수 내역 확인
            <ArrowRight size={18} />
          </button>
        </div>
      )}
    </>
  );
}

function MyComplaints({
  complaints,
  initialQuery,
  busy,
  onSelect,
  onApply,
}: {
  complaints: Complaint[];
  initialQuery: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onApply: () => void;
}) {
  const [query, setQuery] = useState(initialQuery),
    [term, setTerm] = useState(initialQuery),
    [status, setStatus] = useState("all"),
    [page, setPage] = useState(1);
  useEffect(() => {
    setQuery(initialQuery);
    setTerm(initialQuery);
    setPage(1);
  }, [initialQuery]);
  const filtered = complaints.filter(
      (c) =>
        (status === "all" || status === c.status) &&
        [c.title, protectedTitle(c), c.id, c.location].some((t) =>
          t.toLowerCase().includes(term.toLowerCase()),
        ),
    ),
    pages = Math.max(1, Math.ceil(filtered.length / 8));
  return (
    <>
      <div className="cp-status-grid">
        {[["all", "전체"], ...Object.entries(statuses)].map(([key, label]) => (
          <button
            key={key}
            className={status === key ? "active" : ""}
            onClick={() => {
              setStatus(key);
              setPage(1);
            }}
          >
            <span>{label}</span>
            <strong>
              {
                complaints.filter((c) => key === "all" || c.status === key)
                  .length
              }
              <small>건</small>
            </strong>
          </button>
        ))}
      </div>
      <form
        className="cp-list-search"
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(query.trim());
          setPage(1);
        }}
      >
        <label htmlFor="complaint-search">검색어</label>
        <input
          id="complaint-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="접수번호, 제목 또는 장소를 입력해 주세요."
        />
        <button className="cp-btn primary" type="submit">
          <Search size={18} />
          검색
        </button>
      </form>
      <div className="cp-section-heading">
        <p>
          전체 <b>{filtered.length}</b>건{" "}
          <span>
            ({page}/{pages} 페이지)
          </span>
        </p>
        <button className="cp-btn small" onClick={onApply}>
          <FilePenLine size={16} />
          민원 신청
        </button>
      </div>
      <div className="cp-table-wrap">
        <table className="cp-complaint-table">
          <thead>
            <tr>
              <th>번호</th>
              <th>민원 제목 / 접수번호</th>
              <th>분야</th>
              <th>접수일</th>
              <th>처리 상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice((page - 1) * 8, page * 8).map((c, i) => (
              <tr key={c.id}>
                <td>{filtered.length - (page - 1) * 8 - i}</td>
                <td>
                  <button disabled={busy} onClick={() => onSelect(c.id)}>
                    {protectedTitle(c)}
                  </button>
                  <small>{c.id}</small>
                </td>
                <td>{c.category}</td>
                <td>{date(c.created_at)}</td>
                <td>
                  <StatusTag status={c.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length ? (
          <div className="cp-empty">
            <FileText size={42} strokeWidth={1.3} />
            <h3>
              {term ? "검색 결과가 없습니다." : "해당하는 민원이 없습니다."}
            </h3>
            <p>
              {term
                ? "다른 검색어 또는 처리 상태로 조회해 주세요."
                : "민원을 신청하면 이곳에서 확인할 수 있습니다."}
            </p>
          </div>
        ) : null}
      </div>
      {pages > 1 ? (
        <nav className="cp-pagination" aria-label="민원 목록 페이지">
          <button
            disabled={page === 1}
            aria-label="이전 페이지"
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft size={18} />
          </button>
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              aria-current={page === n ? "page" : undefined}
              className={page === n ? "active" : ""}
              onClick={() => setPage(n)}
            >
              {n}
            </button>
          ))}
          <button
            disabled={page === pages}
            aria-label="다음 페이지"
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight size={18} />
          </button>
        </nav>
      ) : null}
    </>
  );
}

function CitizenDetail({
  complaint: c,
  events,
  onBack,
  onRefresh,
}: {
  complaint: Complaint;
  events: Event[];
  onBack: () => void;
  onRefresh:()=>void|Promise<void>;
}) {
  return (
    <>
      <div className="cp-detail-title">
        <StatusTag status={c.status} />
        <h2>{protectedTitle(c)}</h2>
        <span>접수번호 {c.id}</span>
      </div>
      <dl className="cp-summary-table">
        <div>
          <dt>민원 분야</dt>
          <dd>{c.category}</dd>
          <dt>접수일</dt>
          <dd>{date(c.created_at)}</dd>
        </div>
        <div>
          <dt>발생 장소</dt>
          <dd>{c.location}</dd>
        </div>
        <div>
          <dt>발생 일자</dt>
          <dd>{c.occurred_at}</dd>
        </div>
        <div>
          <dt>민원 내용</dt>
          <dd>{c.body}</dd>
        </div>
      </dl>
      <RequestTrackingPanel key={c.id} complaint={c} staff={false} onChanged={onRefresh}/>
      <SupplementPanel complaint={c} staff={false} onChanged={onRefresh}/>
      <section className="cp-citizen-reply">
        <h2>
          <ClipboardCheck size={22} />
          처리 결과 및 답변
        </h2>
        {c.published ? (
          <p><CitationText text={c.published} citations={c.published_citations||[]}/></p>
        ) : (
          <div className="cp-reply-wait">
            <MonitorCheck size={35} />
            <div>
              <strong>담당자의 답변을 기다리고 있습니다.</strong>
              <p>검토를 마친 답변이 등록되면 이곳에서 확인할 수 있습니다.</p>
            </div>
          </div>
        )}
      </section>
      <details className="cp-history">
        <summary>
          처리 이력
          <ChevronDown size={18} />
        </summary>
        {events
          .filter(
            (e) =>
              e.label.includes("접수") ||
              e.label.includes("답변") ||
              e.label.includes("상태"),
          )
          .map((e) => (
            <div key={e.id}>
              <span>{e.label}</span>
              <time>{date(e.created_at)}</time>
            </div>
          ))}
      </details>
      <div className="cp-form-actions">
        <button className="cp-btn" onClick={onBack}>
          목록으로
        </button>
      </div>
    </>
  );
}

function Guide({ onApply }: { onApply: () => void }) {
  return (
    <>
      <div className="cp-guide-box">
        <BookOpen size={37} />
        <div>
          <h2>민원 쉴드, 이렇게 이용하세요</h2>
        </div>
      </div>
      <h2 className="cp-faq-heading">민원 처리 절차</h2>
      <div className="cp-process-guide">
        {[
          {
            icon: FilePenLine,
            title: "민원 신청",
            desc: "불편 사항과 위치, 발생 일자를 작성하고 민원을 접수합니다.",
          },
          {
            icon: Sparkles,
            title: "내용 확인 및 검토",
            desc: "민원 내용과 관련 자료를 확인합니다.",
          },
          {
            icon: ClipboardCheck,
            title: "담당자 답변 등록",
            desc: "담당자가 사실관계와 관련 근거를 검토하고 답변을 승인합니다.",
          },
          {
            icon: MonitorCheck,
            title: "처리 결과 확인",
            desc: "나의 민원에서 진행 상황과 등록된 답변을 확인합니다.",
          },
        ].map((s, i) => (
          <article key={s.title}>
            <span>{String(i + 1).padStart(2, "0")}</span>
            <s.icon size={31} />
            <div>
              <h3>{s.title}</h3>
            </div>
          </article>
        ))}
      </div>
      <h2 className="cp-faq-heading">신청 시 유의 사항</h2>
      <ul className="cp-bullets">
        <li>발생한 상황과 원하는 조치를 구체적으로 알려주세요.</li>
        <li>
          담당자가 사실관계를 확인할 수 있도록 발생 장소와 일자를 작성해 주세요.
        </li>
        <li>실제 개인정보와 민감한 정보는 입력하지 마세요.</li>
      </ul>
      <div className="cp-form-actions">
        <button className="cp-btn primary" onClick={onApply}>
          민원 신청하기
          <ArrowRight size={18} />
        </button>
      </div>
    </>
  );
}

function Laws({ documents }: { documents: LawDocument[] }) {
  return (
    <>
      <div className="cp-guide-box">
        <BookOpen size={37} />
        <div>
          <h2>법령·조례</h2>
        </div>
      </div>
      <div className="cp-law-links">
        {[
          {
            title: "국가법령정보센터",
            desc: "법령·판례·자치법규 공식 원문",
            url: "https://www.law.go.kr/",
          },
          {
            title: "자치법규정보시스템",
            desc: "지방자치단체 조례·규칙",
            url: "https://www.elis.go.kr/",
          },
        ].map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer">
            <BookOpen size={29} />
            <span>
              <strong>{l.title}</strong>
              <small>{l.desc}</small>
            </span>
            <ArrowUpRight size={20} />
          </a>
        ))}
      </div>
      <h2 className="cp-faq-heading">
        작업공간에 연결된 법령·조례 <small>{documents.length}건</small>
      </h2>
      {documents.length ? (
        <div className="cp-law-list">
          {documents.map((d) => (
            <a key={d.id} href={d.source_url} target="_blank" rel="noreferrer">
              <span>
                <strong>{d.title}</strong>
                <small>
                  {d.jurisdiction} · 시행일 {d.effective_date}
                </small>
              </span>
              <ArrowUpRight size={18} />
            </a>
          ))}
        </div>
      ) : (
        <div className="cp-empty">
          <BookOpen size={38} strokeWidth={1.4} />
          <h3>아직 연결된 법령·조례가 없습니다.</h3>
          <p>
            담당자가 공식 데이터를 연결하면 여기에 표시됩니다.
            <br />
            법령 원문은 위의 공식 사이트에서 확인할 수 있습니다.
          </p>
        </div>
      )}
    </>
  );
}
