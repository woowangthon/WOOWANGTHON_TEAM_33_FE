"use client";
import {
  BookOpen,
  ArrowUpRight,
  RefreshCw,
  Link2,
  Download,
  AlertCircle,
} from "lucide-react";
import type { Citation, Complaint } from "../lib/types";

const key = (c: Citation) => c.title + "|" + c.article;

export default function EvidencePanel({
  evidence,
  cited,
  ready,
  busy,
  completed,
  onSearch,
}: {
  evidence: Complaint["evidence"];
  cited: Citation[];
  ready: boolean;
  busy: boolean;
  completed: boolean;
  onSearch: () => void;
}) {
  const citedIds = new Set(cited.map((c) => c.id));
  const citedKeys = new Set(cited.map(key));
  const isCited = (c: Citation) => citedIds.has(c.id) || citedKeys.has(key(c));
  const candidates = evidence?.citations || [];
  const extra = cited.filter(
    (c) => !candidates.some((x) => x.id === c.id || key(x) === key(c)),
  );
  const list = [
    ...candidates.filter(isCited),
    ...extra,
    ...candidates.filter((c) => !isCited(c)),
  ];
  const citedCount = list.filter(isCited).length;

  function download() {
    if (!evidence) return;
    const lines = [
      "# 민원 법령 근거 검토자료",
      `수집: ${evidence.generatedAt}`,
      "적용 여부는 담당자 검토가 필요합니다.",
      ...evidence.citations.flatMap((c) => [
        `\n## ${c.title} ${c.article}`,
        `시행일: ${c.effectiveDate} / 관할: ${c.jurisdiction}`,
        c.text,
        `공식 원문: ${c.sourceUrl}`,
        c.relation || "",
      ]),
      ...evidence.warnings.map((w) => "주의: " + w),
    ];
    const url = URL.createObjectURL(
      new Blob([lines.join("\n\n")], { type: "text/markdown;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "민원-법령근거.md";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="card evidence-panel">
      <div className="card-header">
        <div>
          <h2>
            <BookOpen size={18} /> 관련 법령
          </h2>
          {list.length ? (
            <p className="evidence-count">
              검색 {candidates.length}건 · 답변 인용 {citedCount}건
            </p>
          ) : null}
        </div>
        <div className="evidence-actions">
          {evidence ? (
            <button className="button quiet small" onClick={download}>
              <Download size={14} />
              내보내기
            </button>
          ) : null}
          <button
            className={"button small " + (evidence ? "outline" : "primary")}
            disabled={!ready || busy || completed}
            onClick={onSearch}
          >
            <RefreshCw size={14} className={busy ? "spin" : ""} />
            {evidence ? "다시 찾기" : "법령 찾기"}
          </button>
        </div>
      </div>
      <div className="panel-padding">
        {list.length ? (
          list.map((c) => (
            <details
              className={"source-card" + (isCited(c) ? " cited" : "")}
              key={c.id}
            >
              <summary>
                <div>
                  <strong>
                    {c.title} {c.article}
                  </strong>
                  <span>
                    {c.jurisdiction}
                    {c.effectiveDate ? " · 시행 " + c.effectiveDate : ""}
                  </span>
                </div>
                {isCited(c) ? <em className="cited-tag">답변 인용</em> : null}
              </summary>
              <div className="source-body">
                <p className="preserve">{c.text}</p>
                {c.relation ? (
                  <span className="relation">
                    <Link2 size={13} />
                    {c.relation}
                  </span>
                ) : null}
                <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                  국가법령정보센터 원문 <ArrowUpRight size={14} />
                </a>
              </div>
            </details>
          ))
        ) : (
          <p className="muted-text">
            {evidence
              ? "맞는 조문을 찾지 못했습니다. 법령·조례 자료실에서 직접 검색해 추가할 수 있습니다."
              : "아직 검색한 법령이 없습니다."}
          </p>
        )}
        {evidence?.warnings.map((w, i) => (
          <p className="warning-line" key={i}>
            <AlertCircle size={14} />
            {w}
          </p>
        ))}
      </div>
    </section>
  );
}
