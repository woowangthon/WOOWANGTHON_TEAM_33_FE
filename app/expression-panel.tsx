"use client";
import { ShieldAlert } from 'lucide-react';
import type { Complaint, ExpressionFinding } from '../lib/types';
import { expressionFindings } from '../lib/protection';

const labels:Record<ExpressionFinding['kind'],string>={profanity:'욕설',insult:'비하·인신공격',threat:'위협',sexual_harassment:'성희롱 의심',criticism:'업무 비판·불만'};
export default function ExpressionPanel({complaint:c}:{complaint:Complaint}) {
  const findings=expressionFindings(c);
  if(!findings.length)return null;
  const abusive=findings.some(f=>f.kind!=='criticism');
  return <section className={'card expression-panel'+(abusive?' abusive':'')} aria-label="주의 표현">
    <details>
      <summary>
        <ShieldAlert size={17}/>
        <strong>{abusive?'공격적 표현이 있어 가려 두었습니다':'업무에 대한 불만 표현이 있습니다'}</strong>
        <span className="expression-tags">
          {(Object.entries(labels) as [ExpressionFinding['kind'],string][]).map(([kind,label])=>{
            const count=findings.filter(f=>f.kind===kind).length;
            return count?<span className={'expression-tag '+(kind==='criticism'?'criticism':'detected')} key={kind}>{label} {count}</span>:null;
          })}
        </span>
        <span className="expression-toggle">근거 보기</span>
      </summary>
      <ul className="expression-quote-list">{findings.map((f,i)=><li key={i}><span>{f.source==='title'?'제목':'본문'} · {labels[f.kind]}</span><q>{f.quote}</q></li>)}</ul>
    </details>
  </section>;
}
