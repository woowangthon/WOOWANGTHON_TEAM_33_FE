const labels = ['위치', '대상', '현황', '경과', '피해'] as const;
export type SummaryMemoRow = { label: typeof labels[number]; value: string };

// Only treat a complete label/value memo as structured content. Unknown or
// mixed text stays visible in the legacy paragraph instead of being discarded.
export function parseSummaryMemo(summary: string): SummaryMemoRow[] | null {
  const lines = summary.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const rows: SummaryMemoRow[] = [];
  for (const line of lines) {
    const match = /^(?:[-•]\s*)?(위치|대상|현황|경과|피해)\s*[:：]\s*(.*)$/.exec(line);
    if (!match || rows.some(row => row.label === match[1])) return null;
    const value = match[2].trim();
    if (value) rows.push({ label: match[1] as SummaryMemoRow['label'], value });
  }
  return rows.length ? rows.sort((a, b) => labels.indexOf(a.label) - labels.indexOf(b.label)) : null;
}

export function nonEmptyItems(items: readonly string[]): string[] {
  return items.map(item => item.trim()).filter(Boolean);
}
