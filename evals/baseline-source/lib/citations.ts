import type { Citation } from './types';

export const citationLabel=(c:Citation)=>`${c.title} ${c.article.split(' (')[0]}`;
export function readableCitations(text:string,citations:Citation[]) {
  return text.replace(/\[((?:law|ordin):[^\]]+)\]/g,(_all,id)=>{
    const source=citations.find(c=>c.id===id);
    return source?`【${citationLabel(source)}】`:'【근거 확인 필요】';
  });
}
export function inlineReferences(text:string,citations:Citation[]) {
  const ids:string[]=[],unknown:string[]=[];
  for(const match of text.matchAll(/\[((?:law|ordin):[^\]]+)\]|【([^】]+)】/g)) {
    const matches=citations.filter(c=>match[1]?c.id===match[1]:citationLabel(c)===match[2]);
    if(matches.length===1)ids.push(matches[0].id);else unknown.push(match[0]);
  }
  return {ids:[...new Set(ids)],unknown};
}
