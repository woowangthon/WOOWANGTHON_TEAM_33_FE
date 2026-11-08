"use client";
import { ShieldCheck } from 'lucide-react';
import type { Complaint, ExpressionFinding } from '../lib/types';
import { expressionFindings } from '../lib/protection';

const labels:Record<ExpressionFinding['kind'],string>={profanity:'욕설',insult:'비하·인신공격',threat:'위협',sexual_harassment:'성희롱 의심',criticism:'업무 비판·불만'};
export default function ExpressionPanel({complaint:c}:{complaint:Complaint}) {
  const findings=expressionFindings(c);
  const reviewed=c.analysis?.expressionFindings!==undefined;
  return <section className="card expression-panel" aria-label="욕설·비난 표현 확인">
    <div className="card-header"><h2><ShieldCheck size={18}/> 표현 확인</h2><span className="count-label">{findings.length?`${findings.length}건`:reviewed?'감지된 표현 없음':'분석 대기'}</span></div>
    {findings.length?<div className="panel-padding">
      <div className="expression-tags">
        {(Object.entries(labels) as [ExpressionFinding['kind'],string][]).map(([kind,label])=>{
          const matched=findings.filter(f=>f.kind===kind);
          return matched.length?<span className={'expression-tag '+(kind==='criticism'?'criticism':'detected')} key={kind}>{label} {matched.length}</span>:null;
        })}
      </div>
      {findings.length?<details className="expression-quotes"><summary>판단 근거 원문 보기 ({findings.length}건)</summary>
        <ul>{findings.map((f,i)=><li key={i}><span>{f.source==='title'?'제목':'본문'} · {labels[f.kind]}</span><q>{f.quote}</q></li>)}</ul>
      </details>:null}
    </div>:null}
  </section>;
}
