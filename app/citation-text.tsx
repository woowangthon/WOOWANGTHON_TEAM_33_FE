import type { Citation } from '../lib/types';
import { citationLabel,readableCitations } from '../lib/citations';
export default function CitationText({text,citations}:{text:string;citations:Citation[]}) {
  return <>{readableCitations(text,citations).split(/(【[^】]+】)/g).map((part,i)=>{
    if(!part.startsWith('【'))return part;
    const source=citations.find(c=>'【'+citationLabel(c)+'】'===part);
    return source?<a className="citation-link" key={i} href={source.sourceUrl} target="_blank" rel="noreferrer">{citationLabel(source)}</a>:<span key={i}>{part}</span>;
  })}</>;
}
