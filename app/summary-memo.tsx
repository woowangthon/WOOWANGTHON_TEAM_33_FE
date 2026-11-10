import { parseSummaryMemo } from '../lib/summary-memo';

export default function SummaryMemo({ summary }: { summary: string }) {
  if (!summary.trim()) return null;
  const rows = parseSummaryMemo(summary);
  if (!rows) return <p className="summary-box summary-paragraph">{summary}</p>;
  return (
    <dl className="summary-box summary-memo">
      {rows.map(row => (
        <div className="summary-memo-row" key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
