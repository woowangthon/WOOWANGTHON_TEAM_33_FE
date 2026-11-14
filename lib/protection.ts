import type { Complaint, ExpressionFinding } from './types';

// Apply only source-verified spans supplied by the model. No keyword classifier.
export function maskText(text: string, quotes: string[] = []) {
  let result = text;
  for (const quote of [...new Set(quotes)].filter(q => q.length >= 2).sort((a, b) => b.length - a.length))
    result = result.split(quote).join('[보호된 표현]');
  return result;
}
export function protectedTitle(c: Pick<Complaint, 'title' | 'analysis' | 'display_title'>) {
  // Unreviewed original titles stay behind the original-text disclosure.
  if (!c.analysis) return '민원 분석 대기';
  const title=maskText(c.analysis.safeTitle || c.analysis.requests?.[0] || '',c.analysis.sensitiveQuotes).trim();
  if(title.includes('[보호된 표현]'))return maskText(c.analysis.requests?.[0]||'민원 내용 확인',c.analysis.sensitiveQuotes).slice(0,100);
  return title||'민원 내용 확인';
}
export function expressionFindings(c: Pick<Complaint, 'title' | 'body' | 'analysis'>): ExpressionFinding[] {
  return (c.analysis?.expressionFindings || []).filter(f =>
    (f.source === 'title' || f.source === 'body') && f.quote.length >= 2 && c[f.source].includes(f.quote)
  );
}
