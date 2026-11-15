import { officeJurisdiction,harnessPolicy } from './harness-policy';
import { AppError, database, now } from './server';
import type { Citation, Complaint } from './types';
import { maskText } from './protection';

type Obj = Record<string,unknown>;
export type Article = {number:string;title:string;text:string;effectiveDate:string};
export type StoredDoc = {id:string;owner:string;source_id:string;title:string;kind:'law'|'ordin';jurisdiction:string;effective_date:string;source_url:string;articles:string;imported_at:string;valid_from?:string;valid_to?:string;version_mst?:string};
export function objects(value:unknown):Obj[] {
  if(Array.isArray(value)) return value.flatMap(objects);
  if(!value || typeof value!=='object') return [];
  const obj=value as Obj;
  return [obj,...Object.values(obj).flatMap(objects)];
}
function str(v:unknown):string { if(typeof v==='string'||typeof v==='number')return String(v); if(v&&typeof v==='object')return str((v as Obj).content);return ''; }
function field(o:Obj,...keys:string[]) {for(const k of keys) {const s=str(o[k]);if(s)return s;}return '';}
export function isoDate(value:string) {const s=value.replace(/[^0-9]/g,''); return s.length===8?`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`:'';}
async function official(oc:string,path:string,params:Record<string,string>) {
  if(!oc)throw new AppError('현재 법령 검색을 사용할 수 없습니다.',503);
  // The registered service origin is required even for server-to-server API calls.
  // Never take it from an incoming request or use the law provider's own domain.
  let origin:URL;
  try {
    origin=new URL(process.env.SERVICE_LAW_ORIGIN||'');
    if(origin.protocol!=='https:'||origin.username||origin.password)throw new Error();
  }catch {throw new AppError('법령 조회 서버의 서비스 주소 설정을 확인해 주세요.',503);}
  const url=new URL('https://www.law.go.kr/DRF/'+path);
  Object.entries({OC:oc,type:'JSON',...params}).forEach(([k,v])=>url.searchParams.set(k,v));
  let response:Response;
  try {response=await fetch(url,{headers:{Accept:'application/json',Referer:origin.origin+'/'},signal:AbortSignal.timeout(20000),redirect:'error'});} catch {throw new AppError('국가법령정보센터 연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.',502);}
  if(!response.ok)throw new AppError('국가법령정보센터에서 요청을 처리하지 못했습니다. 인증값과 API 사용 승인을 확인해 주세요.',502);
  const text=await response.text();
  if(text.length>4000000)throw new AppError('문서가 너무 큽니다. 더 작은 범위의 법령을 선택해 주세요.',413);
  let json:unknown;
  try {json=JSON.parse(text);}catch {throw new AppError('법제처 응답을 읽을 수 없습니다. OC 인증값·이용 승인·접속 제한을 확인해 주세요.',502);}
  // The official API can return HTTP 200 with an error envelope instead of results.
  // Inspect that envelope only; legal article text may itself discuss authentication failures.
  const envelope=json&&typeof json==='object'&&!Array.isArray(json)?json as Obj:null;
  const result=envelope&&typeof envelope.result==='string'?envelope.result:'';
  const message=envelope&&typeof envelope.msg==='string'?envelope.msg:'';
  if(/실패|오류|제한|불가/.test(result)) {
    if(/사용자|인증/.test(result)||/IP주소|도메인주소/.test(message))
      throw new AppError('법제처 사용자 인증에 실패했습니다. API 사용 승인과 등록한 도메인·서버 IP를 확인해 주세요.',502);
    if(/필수입력|필수 입력/.test(result+' '+message))
      throw new AppError('법제처가 요청 입력값을 확인하지 못했습니다. API 인증값과 신청 상태를 확인해 주세요.',502);
    throw new AppError('법제처에서 조회 요청을 거부했습니다. API 신청 상태와 사용 한도를 확인해 주세요.',502);
  }
  return json;
}
export async function searchOfficial(oc:string,query:string,kind:'law'|'ordin',extra:Record<string,string>={}) {
  const json=await official(oc,'lawSearch.do',{target:kind==='law'?'eflaw':'ordin',query,display:'100',nw:kind==='law'?'3':'1',...extra});
  const seen=new Set<string>();
  return objects(json).flatMap(o=>{
    const id=field(o,kind==='law'?'법령ID':'자치법규ID');
    const title=field(o,'법령명한글','법령명_한글','자치법규명');
    const mst=field(o,'법령일련번호','자치법규일련번호')||field(o,'자치법규상세링크').match(/MST=(\d+)/i)?.[1]||'';
    const version=mst||id;
    if(!id||!title||seen.has(version)||!/^[0-9]+$/.test(id))return [];
    seen.add(version);return [{id,mst,title,kind,effectiveDate:isoDate(field(o,'시행일자')),jurisdiction:kind==='law'?'전국':field(o,'지자체기관명','지자체명')||'원문 확인'}];
  });
}
function articleText(o:Obj):string {
  const values:string[]=[];
  for(const [k,v] of Object.entries(o)) {
    if(['조문내용','조내용','항내용','호내용','목내용'].includes(k)) { const s=str(v);if(s)values.push(s); else if(Array.isArray(v)) values.push(...v.map(str).filter(Boolean)); }
    else if(v&&typeof v==='object') { if(Array.isArray(v)) values.push(...v.map(x=>typeof x==='object'&&x?articleText(x as Obj):'')); else values.push(articleText(v as Obj)); }
  }
  return values.filter(Boolean).join('\n').replace(/<[^>]+>/g,'').trim();
}
export function parseOfficialDocument(json:unknown,kind:'law'|'ordin') {
  const nodes=objects(json);
  const meta=nodes.find(o=>field(o,kind==='law'?'법령명_한글':'자치법규명'));
  if(!meta)throw new AppError('법령 메타데이터를 확인할 수 없어 가져오기를 중단했습니다.',502);
  const title=field(meta,'법령명_한글','자치법규명');
  const effective=isoDate(field(meta,'시행일자'));
  if(!effective)throw new AppError('시행일을 확인할 수 없는 문서는 검색 자료로 등록할 수 없습니다.',502);
  const seen=new Set<string>();
  const articles=nodes.flatMap(o=>{
    const text=articleText(o);
    // National-law API uses '전문' for chapter/section headings sharing the next article's number.
    // Exclude those before deduplication so they cannot replace the actual legal provision.
    if(!text||['N','전문'].includes(field(o,'조문여부'))||(!field(o,'조문제목','조제목')&&/^제\s*\d+\s*[편장절관](?:\s|$)/.test(text)))return [];
    // ELIS-backed ordinance JSON repeats the same six-digit article code in an array.
    const numbers=[...new Set((Array.isArray(o.조문번호)?o.조문번호:[o.조문번호]).map(str).filter(Boolean))];
    if(!numbers.length)return [];
    if(numbers.length!==1||!/^\d+$/.test(numbers[0]))throw new AppError('공식 원문의 조문 번호를 확인할 수 없습니다.',502);
    const code=numbers[0];
    const encoded=kind==='ordin'&&/^\d{6}$/.test(code);
    const number=Number(encoded?code.slice(0,4):code);
    const suffix=Number(encoded?code.slice(4):field(o,'조문가지번호')||'0');
    if(number<1||!Number.isFinite(suffix))throw new AppError('공식 원문의 조문 번호를 확인할 수 없습니다.',502);
    const label=`제${number}조${suffix?'의'+suffix:''}`;
    if(seen.has(label))return [];seen.add(label);
    return [{number:label,title:field(o,'조문제목','조제목'),text,effectiveDate:isoDate(field(o,'조문시행일자'))||effective}];
  });
  if(!articles.length)throw new AppError('조문을 찾을 수 없습니다. 공식 원문을 확인해 주세요.',502);
  return {title,effective,articles,jurisdiction:kind==='law'?'전국':field(meta,'지자체기관명','지자체명')||(title.includes(officeJurisdiction)?officeJurisdiction:'관할 확인 필요')};
}
export async function testLawConnection(oc:string) {
  // Search and body permissions can differ. Check both national and local data
  // without persisting the connection-test documents in the workspace.
  await Promise.all((['law','ordin'] as const).map(async kind=>{
    const query=automaticQueries['생활폐기물'][kind];
    const results=await searchOfficial(oc,query,kind);
    const found=chooseOfficial(results,query,kind);
    if(!found)throw new AppError(`${kind==='law'?'법률':officeJurisdiction+' 자치법규'} 검색 응답을 확인하지 못했습니다. 법제처 이용 승인과 OC 인증값을 확인해 주세요.`,400);
    parseOfficialDocument(await official(oc,'lawService.do',{target:kind==='law'?'eflaw':'ordin',ID:found.id}),kind);
  }));
  return true;
}
export async function importDocument(owner:string,oc:string,id:string,kind:'law'|'ordin',version?:{mst:string;effectiveDate:string;validTo?:string}) {
  const json=await official(oc,'lawService.do',{target:kind==='law'?'eflaw':'ordin',...(version?.mst?{MST:version.mst,...(kind==='law'?{efYd:version.effectiveDate.replaceAll('-','')}:{})}:{ID:id})});
  const doc=parseOfficialDocument(json,kind);
  // The initial workspace is Cheongju; avoid silently mixing other municipalities.
  if(kind==='ordin'&&!doc.title.includes(officeJurisdiction)&&!doc.jurisdiction.includes(officeJurisdiction))throw new AppError('현재 작업공간의 관할('+officeJurisdiction+')과 다른 조례입니다.');
  if(version&&doc.effective!==version.effectiveDate)throw new AppError('요청한 시행일과 다른 법령이 반환되어 근거 수집을 중단했습니다.',502);
  const sourceUrl=version?.mst?(kind==='law'?`https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${version.mst}&efYd=${doc.effective.replaceAll('-','')}`:`https://www.law.go.kr/LSW/ordinInfoP.do?ordinSeq=${version.mst}`):`https://www.law.go.kr/${kind==='law'?'법령':'자치법규'}/${encodeURIComponent(doc.title)}`;
  const key=owner+':'+kind+':'+id+(version?.mst?':'+version.mst+':'+doc.effective:'');
  await database().prepare('INSERT INTO documents (id,owner,source_id,title,kind,jurisdiction,effective_date,source_url,articles,imported_at,valid_from,valid_to,version_mst) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,jurisdiction=excluded.jurisdiction,effective_date=excluded.effective_date,source_url=excluded.source_url,articles=excluded.articles,imported_at=excluded.imported_at,valid_from=excluded.valid_from,valid_to=excluded.valid_to,version_mst=excluded.version_mst').bind(key,owner,id,doc.title,kind,doc.jurisdiction,doc.effective,sourceUrl,JSON.stringify(doc.articles),now(),doc.effective,version?.validTo||null,version?.mst||null).run();
  return {title:doc.title,articleCount:doc.articles.length};
}
export const automaticQueries:Record<string,{law:string;ordin:string}>={
  '생활폐기물':{law:'폐기물관리법',ordin:'청주시 폐기물관리에 관한 조례'},
  '소음·환경':{law:'소음ㆍ진동관리법',ordin:'청주시 소음'},
  '도로·교통':{law:'도로법',ordin:'청주시 도로'},
  '기타':{law:'민원 처리에 관한 법률',ordin:'청주시 민원'},
};
const normalizeTitle=(value:string)=>value.replace(/[\sㆍ·]/g,'');
export type SearchPlan={profiles:string[];terms:string[];sources:{kind:'law'|'ordin';query:string}[];meaning?:string;facts?:import('./summary-harness').SummaryFact[];requestCandidates?:import('./summary-harness').SummaryFact[];requestDecisions?:{index:number;decision:'represented'|'duplicate'|'not_request';requestIndices:number[];reason:string}[];quoteRepairs?:import('./summary-harness').QuoteRepair[];validationRecoveries?:import('./summary-harness').ValidationRecovery[];sourceHash?:string;harnessVersion?:number};
// Offline fallback only searches existing documents; no category-specific law suggestions.
export function searchPlan(_category:string,input?:{title:string;body:string}):SearchPlan {
  return {profiles:[],terms:[...tokens((input?.title||'')+' '+(input?.body||''))],sources:[]};
}
function chooseOfficial(results:Awaited<ReturnType<typeof searchOfficial>>,query:string,kind:'law'|'ordin') {
  const normalized=normalizeTitle;
  const exact=results.find(r=>normalized(r.title)===normalized(query));
  return exact||(kind==='ordin'?results.find(r=>r.title.includes(officeJurisdiction)&&normalized(r.title).includes(normalized(query))):undefined);
}
export async function autoSync(owner:string,oc:string,category:string,input?:{title:string;body:string;occurred_at?:string},selectedPlan?:SearchPlan) {
  const plan=selectedPlan||searchPlan(category,input),notes:string[]=[];
  const date=input?.occurred_at||now().slice(0,10);
  const stored=await database().prepare('SELECT * FROM documents WHERE owner=?').bind(owner).all<StoredDoc>();
  for(let i=0;i<plan.sources.length;i+=3)await Promise.all(plan.sources.slice(i,i+3).map(async ({kind,query})=>{
    try {
      if(stored.results.some(d=>d.kind===kind&&normalizeTitle(d.title)===normalizeTitle(query)&&!!d.version_mst&&d.effective_date<=date&&(!d.valid_to||date<d.valid_to)&&Date.now()-Date.parse(d.imported_at)<86400000))return;
      const results=await searchOfficial(oc,query,kind);
      const chosen=results.find(r=>normalizeTitle(r.title)===normalizeTitle(query));
      if(!chosen){notes.push(`${query}: 공식 검색 결과를 확인하지 못했습니다.`);return;}
      let version=chosen,validTo:string|undefined;
      if(chosen.effectiveDate>date){
        let history:typeof results=[];
        for(let page=1;page<=5;page++){
          const rows=await searchOfficial(oc,query,kind,{nw:kind==='law'?'1':'2',page:String(page),sort:'efdes',efYd:'19000101~'+date.replaceAll('-',''),...(kind==='law'?{LID:chosen.id}:{})});
          history.push(...rows.filter(r=>normalizeTitle(r.title)===normalizeTitle(query)&&r.effectiveDate<=date));
          if(rows.length<100)break;
          if(page===5)throw new AppError('연혁 검색 범위를 초과하여 발생일 기준 법령을 확정하지 못했습니다.',502);
        }
        history.sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate)||Number(b.mst)-Number(a.mst));
        if(!history.length||!history[0].mst)throw new AppError('발생일에 시행 중인 연혁을 확인하지 못했습니다.',502);
        version=history[0];
        // The upper bound is the first later enactment, including intervening historical revisions.
        const later=await searchOfficial(oc,query,kind,{nw:kind==='law'?'1,3':'2',sort:'efasc',efYd:version.effectiveDate.replaceAll('-','')+'~'+chosen.effectiveDate.replaceAll('-',''),...(kind==='law'?{LID:chosen.id}:{})});
        validTo=[chosen,...later].filter(r=>normalizeTitle(r.title)===normalizeTitle(query)&&r.effectiveDate>version.effectiveDate).map(r=>r.effectiveDate).sort()[0];
        // Cache only through this requested day if the provider did not reveal a tighter boundary.
        const nextDay=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
        if(!validTo||validTo>nextDay)validTo=nextDay;
      }
      if(!version.mst)throw new AppError('법령의 연혁 식별자를 확인하지 못했습니다.',502);
      await importDocument(owner,oc,chosen.id,kind,{...version,validTo});
    } catch(e) {notes.push(`${query}: ${e instanceof AppError?e.message:'법령 동기화에 실패했습니다.'}`);}
  }));
  return notes;
}
export function tokens(text:string) {
  const words=text.toLowerCase().match(/[가-힣a-z0-9]{2,}/g)||[]; const result=new Set<string>();
  for(const word of words){result.add(word);if(/[가-힣]/.test(word))for(let i=0;i<word.length-1;i++)result.add(word.slice(i,i+2));} return result;
}
export function retrieve(docs:StoredDoc[],input:Pick<Complaint,'title'|'body'|'category'|'occurred_at'|'location'>,selectedPlan?:SearchPlan,limit=8) {
  // Complaint meaning should outrank repeated category labels and abusive language.
  const plan=selectedPlan||searchPlan(input.category,input);
  const content=maskText(plan.meaning||input.title+' '+input.body).replaceAll('[보호된 표현]','');
  const query=tokens(content);
  const expectedTitles=new Set(plan.sources.map(s=>normalizeTitle(s.query)));
  const hasPlannedDocs=docs.some(d=>expectedTitles.has(normalizeTitle(d.title)));
  const expanded=[...new Set(plan.terms)];
  const date=input.occurred_at||now().slice(0,10);
  const candidates:({score:number}&Citation)[]=[];
  const warnings:string[]=[];
  const applicable=docs.filter(d=>d.effective_date<=date&&(!d.valid_to||date<d.valid_to));
  for(const d of docs)if((!hasPlannedDocs||expectedTitles.has(normalizeTitle(d.title)))&&d.effective_date>date&&!applicable.some(a=>a.kind===d.kind&&a.source_id===d.source_id))warnings.push(`${d.title}: 발생일 이후 시행 자료이므로 제외했습니다.`);
  const newest=new Map<string,StoredDoc>();
  for(const d of applicable){const key=d.kind+':'+d.source_id,prev=newest.get(key);if(!prev||d.effective_date>prev.effective_date||(d.effective_date===prev.effective_date&&!!d.version_mst&&!prev.version_mst))newest.set(key,d);}
  for(const doc of newest.values()){
    if(hasPlannedDocs&&!expectedTitles.has(normalizeTitle(doc.title)))continue;
    if(doc.effective_date>date){warnings.push(`${doc.title}: 발생일 이후 시행 자료이므로 제외했습니다.`);continue;}
    if(doc.kind==='ordin'&&!doc.jurisdiction.includes(officeJurisdiction))continue;
    if(Date.now()-Date.parse(doc.imported_at)>7*86400000){warnings.push(`${doc.title}: 동기화한 지 7일이 지나 검색에서 제외했습니다. 자료실에서 새로 가져와 주세요.`);continue;}
    const articles=JSON.parse(doc.articles) as Article[];
    for(const a of articles){if(a.effectiveDate>date||a.text.length>24000)continue;
      const textTokens=tokens(a.text);const heading=tokens(a.title);
      let textScore=0,headingScore=0;
      for(const t of query){if(textTokens.has(t))textScore+=1;if(heading.has(t))headingScore+=2;}
      const compactHeading=a.title.replace(/\s|[ㆍ·]/g,'');
      const compactText=a.text.replace(/\s|[ㆍ·]/g,'');
      for(const term of expanded){if(compactHeading.includes(term))headingScore+=2;if(compactText.includes(term))textScore+=0.5;}
      const score=headingScore+textScore/(1+Math.log1p(a.text.length/300));
      if(score<harnessPolicy.retrieval.minimumScore)continue;
      const relation=[...a.text.matchAll(/「([^」]+)」/g)].map(m=>m[1]).filter(name=>docs.some(d=>d.kind==='law'&&d.title.replace(/\s/g,'')===name.replace(/\s/g,''))).join(', ');
      candidates.push({id:doc.kind+':'+doc.source_id+':'+a.number,score,title:doc.title,article:a.number+(a.title?' ('+a.title+')':''),text:a.text,sourceUrl:doc.source_url,effectiveDate:a.effectiveDate,jurisdiction:doc.jurisdiction,kind:doc.kind,relation:relation?`조문에서 직접 인용: ${relation}`:undefined});
    }
  }
  candidates.sort((a,b)=>b.score-a.score);
  // Balance national and local sources, then fill remaining positions by relevance.
  const selected:typeof candidates=[];
  for(const kind of ['law','ordin'])selected.push(...candidates.filter(c=>c.kind===kind).slice(0,2));
  // Include relevant articles from distinct documents for multi-topic complaints.
  for(const c of candidates)if(selected.length<limit&&!selected.some(s=>s.title===c.title))selected.push(c);
  for(const c of candidates)if(selected.length<limit&&!selected.some(s=>s.id===c.id))selected.push(c);
  return {citations:selected.map(({score:_score,...c})=>c),warnings:[...new Set(warnings)],mode:'민원 표현·동의어 검색 · 조문 관련도 정렬 · 관할/시행일 필터'};
}
