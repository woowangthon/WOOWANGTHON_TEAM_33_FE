import type { Complaint, ExpressionFinding } from './types';

// High-confidence words only. Contextual criticism and threats are reviewed separately.
const profanityPattern = /(?:[시씨][\s.·]*[발빨팔](?!점|역|열차)|병[\s.·]*신|개[\s.·]*새[\s.·]*끼|새끼|지[\s.·]*랄|좆|존나|ㅅ[\s.·]*ㅂ|ㅂ[\s.·]*ㅅ|미친놈|미친년)/gu;
export function profanityQuotes(text: string) {
  return [...new Set(text.match(profanityPattern) || [])];
}
export function maskText(text: string, quotes: string[] = []) {
  let result = text;
  for (const quote of [...quotes].filter(q => q.length >= 2).sort((a, b) => b.length - a.length))
    result = result.split(quote).join('[보호된 표현]');
  return result.replace(profanityPattern, '[보호된 표현]').replace(/(?:\[보호된 표현\])+(?:럼|놈|년|새끼|련)?(?:들아|에게|아|들|이|은|는|을)?/g,'[보호된 표현]');
}
export function protectedTitle(c: Pick<Complaint, 'title' | 'analysis' | 'display_title'>) {
  const title=maskText(c.analysis?.safeTitle || c.display_title || c.title,c.analysis?.sensitiveQuotes).trim();
  if(title.includes('[보호된 표현]'))return maskText(c.analysis?.requests?.[0]||title.replaceAll('[보호된 표현]','').trim()||'민원 내용 확인').slice(0,100);
  return title||'민원 내용 확인';
}
export function expressionFindings(c: Pick<Complaint, 'title' | 'body' | 'analysis'>): ExpressionFinding[] {
  const findings = (c.analysis?.expressionFindings || []).filter(f => c[f.source].includes(f.quote));
  const result = [...findings];
  for (const source of ['title', 'body'] as const) {
    for (const quote of profanityQuotes(c[source])) {
      if (!result.some(f => f.kind === 'profanity' && f.source === source && f.quote.includes(quote)))
        result.push({ kind: 'profanity', source, quote, reason: '직접적인 욕설 표현이 포함되어 있습니다.' });
    }
  }
  return result;
}
