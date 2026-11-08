"use client";
import {
  BookOpen,
  ArrowUpRight,
  RefreshCw,
  Link2,
  Download,
  AlertCircle,
} from "lucide-react";
import type { Complaint } from "../lib/types";
export default function EvidencePanel({
  evidence,
  ready,
  busy,
  completed,
  onSearch,
}: {
  evidence: Complaint["evidence"];
  ready: boolean;
  busy: boolean;
  completed: boolean;
  onSearch: () => void;
}) {
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
            <BookOpen size={19} /> 공식 법령 근거 정리
          </h2>
        </div>
        <button
          className="button primary"
          disabled={!ready || busy || completed}
          onClick={onSearch}
        >
          <RefreshCw size={16} className={busy ? "spin" : ""} />
          법령 근거 찾기
        </button>
      </div>
      <div className="panel-padding">
        {evidence ? (
          <>
            <div className="section-heading">
              <span className="count-label">
                {evidence.citations.length}개 검색 후보
              </span>
              <button className="button outline small" onClick={download}>
                <Download size={15} />
                근거 내보내기
              </button>
            </div>
            {evidence.citations.length ? (
              evidence.citations.map((c, i) => (
                <details className="source-card" key={c.id}>
                  <summary>
                    <span className="source-index">{i + 1}</span>
                    <div>
                      <strong>{c.title}</strong>
                      <span>
                        {c.article} · {c.jurisdiction} · 시행 {c.effectiveDate}
                      </span>
                    </div>
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
                조건에 맞는 근거를 찾지 못했습니다. 자료실에서 관련 법령을 직접
                검색해 추가해 주세요.
              </p>
            )}
            {evidence.warnings.map((w, i) => (
              <p className="warning-line" key={i}>
                <AlertCircle size={14} />
                {w}
              </p>
            ))}
          </>
        ) : (
          <p className="muted-text">검색된 근거가 없습니다.</p>
        )}
      </div>
    </section>
  );
}
