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

// Do not repeat an attack in the work summary, even when it was paraphrased.
const attackNarrative = /(?:담당자|공무원|직원|너|당신).{0,50}(?:이름|실명|신상|신원).{0,40}(?:공개|유포|올리|게시)|(?:찾아가|찾아와|찾아오).{0,30}(?:죽|때리|가만두|해치)|(?:죽이겠|죽여버|가만두지|해치겠|협박|위협|욕설|인신공격|성희롱)/u;
export function businessSummary(c:Pick<Complaint,'title'|'body'|'analysis'|'display_title'>) {
  // New results have already passed source/role-aware verification. Never delete or
  // truncate their sentences at display time: that could erase a victim report.
  if(c.analysis?.summaryHarness?.status==='verified')return c.analysis.summary;
  // Read compatibility for old stored results, until explicitly reanalysed.
  const quotes=[...(c.analysis?.sensitiveQuotes||[]),...expressionFindings(c).filter(f=>f.kind!=='criticism').map(f=>f.quote)];
  const sentences=(c.analysis?.summary||'').match(/[^.!?\n]+(?:[.!?]+|$)/gu)||[];
  const safe=sentences.map(s=>s.trim()).filter(s=>s&&!maskText(s,quotes).includes('[보호된 표현]')&&!attackNarrative.test(s));
  let result='';
  for(const sentence of safe.slice(0,2)) {
    if((result+' '+sentence).trim().length>220)break;
    result+=(result?' ':'')+sentence;
  }
  return result;
}
export function expressionFindings(c: Pick<Complaint, 'title' | 'body' | 'analysis'>): ExpressionFinding[] {
  return allExpressionFindings(c).filter(f=>f.scope!=='reported_speech');
}
export function allExpressionFindings(c: Pick<Complaint, 'title' | 'body' | 'analysis'>): ExpressionFinding[] {
  const findings = (c.analysis?.expressionFindings || []).filter(f => c[f.source].includes(f.quote));
  const result = [...findings];
  // A completed contextual assessment is authoritative. The vocabulary list is
  // only a display signal before analysis or for legacy records without findings.
  if(c.analysis?.expressionFindings)return result;
  for (const source of ['title', 'body'] as const) {
    for (const quote of profanityQuotes(c[source])) {
      if (!result.some(f => f.kind === 'profanity' && f.source === source && f.quote.includes(quote)))
        result.push({ kind: 'profanity', source, quote, reason: '직접적인 욕설 표현이 포함되어 있습니다.' });
    }
  }
  return result;
}
