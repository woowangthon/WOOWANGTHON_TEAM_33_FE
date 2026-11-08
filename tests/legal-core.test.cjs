const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const previousOrigin=process.env.SERVICE_LAW_ORIGIN;
process.env.SERVICE_LAW_ORIGIN='https://shield.example';
after(()=>{if(previousOrigin===undefined)delete process.env.SERVICE_LAW_ORIGIN;else process.env.SERVICE_LAW_ORIGIN=previousOrigin;});
const source=fs.readFileSync('lib/laws.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exportsObj={};
const protection={};new Function('exports',ts.transpileModule(fs.readFileSync('lib/protection.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(protection);
class AppError extends Error {}
new Function('require','exports',js)(name=>{if(name==='./protection')return protection;if(name==='./server')return {AppError,now:()=>new Date().toISOString(),database:()=>{throw new Error('No live database in pure retrieval tests');}};throw new Error(name);},exportsObj);
const {parseOfficialDocument,retrieve}=exportsObj;
test('expanded plans distinguish floor noise, parking, construction, animal and park complaints',()=>{
 const plan=(text)=>exportsObj.searchPlan('기타',{title:text,body:text});
 assert.ok(plan('윗집 층간소음').sources.some(s=>s.query==='공동주택관리법'));
 assert.equal(plan('윗집 층간소음').sources.some(s=>s.query==='소음ㆍ진동관리법'),false);
 assert.ok(plan('횡단보도 불법 주차').sources.some(s=>s.query==='도로교통법'));
 assert.ok(plan('무허가 건축 증축').sources.some(s=>s.query==='건축법'));
 assert.ok(plan('유기견 보호 요청').sources.some(s=>s.query==='동물보호법'));
 assert.ok(plan('공원시설 파손').sources.some(s=>s.query==='도시공원 및 녹지 등에 관한 법률'));
 assert.ok(plan('알 수 없는 요청').sources.some(s=>s.query==='민원 처리에 관한 법률'));
});
test('national law: preserves subparagraphs, article branch and effective date',()=>{
  const result=parseOfficialDocument({법령:{기본정보:{법령명_한글:'검증용 가상법',시행일자:'20260101'},조문:{조문단위:[{조문번호:'8',조문가지번호:'2',조문여부:'Y',조문제목:'검증',조문내용:'가상의 본문',항:[{항내용:'가상의 항',호:[{호내용:'가상의 호'}]}]}]}}},'law');
  assert.equal(result.articles[0].number,'제8조의2');assert.match(result.articles[0].text,/가상의 항\n가상의 호/);assert.equal(result.effective,'2026-01-01');
});
test('chapter headings sharing an article number cannot shadow the actual provision',()=>{
 const result=parseOfficialDocument({법령:{기본정보:{법령명_한글:'검증법',시행일자:'20200101'},조문:{조문단위:[
  {조문번호:'34',조문여부:'전문',조문내용:'제4절 동물의 구조 등'},
  {조문번호:'34',조문여부:'조문',조문제목:'동물의 구조ㆍ보호',조문내용:'제34조(동물의 구조ㆍ보호) 가상 구조 조항'},
 ]}}},'law');assert.equal(result.articles.length,1);assert.equal(result.articles[0].title,'동물의 구조ㆍ보호');assert.match(result.articles[0].text,/가상 구조 조항/);
});
test('ordinance: parses official alternative title and content field names',()=>{
  const result=parseOfficialDocument({자치법규:{기본정보:{자치법규명:'청주시 가상 검증 조례',시행일자:'20260101',지자체기관명:'충청북도 청주시'},조문:{조:[{조문번호:'1',조문여부:'Y',조제목:'목적',조내용:'검색 동작 검증을 위한 가상 조문입니다.'}]}}},'ordin');
  assert.equal(result.articles[0].title,'목적');assert.equal(result.jurisdiction,'충청북도 청주시');
});

test('ordinance: decodes repeated six-digit article codes including branch numbers',()=>{
 const result=parseOfficialDocument({LawService:{자치법규기본정보:{자치법규명:'청주시 가상 검증 조례',시행일자:'20260101',지자체기관명:'충청북도 청주시'},조문:{조:[
  {조문번호:['000100','000100'],조문여부:'Y',조제목:'목적',조내용:'제1조(목적) 검증용 가상 조문'},
  {조문번호:['000402','000402'],조문여부:'Y',조제목:'검증',조내용:'제4조의2(검증) 가지번호를 포함하는 가상 조문'},
 ]}}},'ordin');
 assert.deepEqual(result.articles.map(a=>a.number),['제1조','제4조의2']);
 assert.throws(()=>parseOfficialDocument({자치법규명:'청주시 가상 조례',시행일자:'20260101',조문번호:['000100','000200'],조내용:'제1조 내용'},'ordin'),/조문 번호/);
});
test('unknown metadata never becomes searchable law',()=>{
  assert.throws(()=>parseOfficialDocument({error:'invalid key'},'law'));
  assert.throws(()=>parseOfficialDocument({법령명_한글:'가상법',조문번호:'1',조문내용:'가상 조문'},'law'));
});
const today=new Date().toISOString().slice(0,10);
function doc(id,overrides={}) {return {id,owner:'a',source_id:id,title:'검증용 가상 폐기물법',kind:'law',jurisdiction:'전국',effective_date:'2020-01-01',source_url:'https://www.law.go.kr/',articles:JSON.stringify([{number:'제1조',title:'폐기물',text:'폐기물 쓰레기 배출 수거 관리 가상 조문',effectiveDate:'2020-01-01'}]),imported_at:new Date().toISOString(),...overrides};}
const input={title:'쓰레기 수거 요청',body:'폐기물 쓰레기 수거',category:'생활폐기물',location:'청주시',occurred_at:today};
test('retrieval excludes future, stale and out-of-jurisdiction material',()=>{
  const docs=[doc('valid'),doc('future',{effective_date:'2099-01-01'}),doc('stale',{imported_at:'2020-01-01T00:00:00Z'}),doc('wrong-city',{kind:'ordin',jurisdiction:'부산광역시'})];
  const result=retrieve(docs,input);assert.equal(result.citations.length,1);assert.equal(result.citations[0].title,'검증용 가상 폐기물법');assert.equal(result.warnings.length,2);
});
test('unrelated or missing sources yield no fabricated citations',()=>{
  assert.equal(retrieve([],input).citations.length,0);
  assert.equal(retrieve([doc('irrelevant',{title:'가상 동물 법규',articles:JSON.stringify([{number:'제1조',title:'조류',text:'참새 조류 서식지 산림',effectiveDate:'2020-01-01'}])})],input).citations.length,0);
});

test('short household complaints retrieve public duties and disposal rules before operator penalties',()=>{
 const article=(number,title,text)=>({number,title,text,effectiveDate:'2020-01-01'});
 const law=doc('law',{title:'폐기물관리법',articles:JSON.stringify([
  article('제14조의2','생활폐기물 수집ㆍ운반 대행자에 대한 과징금 처분','생활폐기물 수집 운반 대행자 과징금 처분'),
  article('제14조의5','생활폐기물 수집ㆍ운반 관련 안전기준 등','생활폐기물 수집 운반 대행자의 안전기준'),
  article('제14조','생활폐기물의 처리 등','시장 군수 구청장은 관할 구역에서 배출되는 생활폐기물을 처리하여야 한다.'),
 ])});
 const ordin=doc('ordin',{title:'청주시 폐기물관리에 관한 조례',kind:'ordin',jurisdiction:'청주시',articles:JSON.stringify([
  article('제20조','생활폐기물 수집운반 대행료의 정산 등','생활폐기물 수집 운반 대행료 정산'),
  article('제11조','폐기물의 배출방법 등','생활폐기물은 종량제봉투에 담아 정해진 배출 장소에 배출하여야 한다.'),
 ])});
 for(const body of ['집 앞에 쓰레기 있어요','우리집앞에 쓰레기 있잖아 병신아 장난해?','쓰레기를 치워주세요']){
  const r=retrieve([law,ordin],{...input,title:'씨발 집 앞',body});
  assert.match(r.citations.find(c=>c.kind==='law').article,/^제14조 \(/);
  assert.match(r.citations.find(c=>c.kind==='ordin').article,/^제11조 \(/);
 }
 const specific=retrieve([law,ordin],{...input,title:'대행업체 과징금',body:'생활폐기물 수집 운반 대행자 과징금 처분 근거를 확인해주세요'});
 assert.match(specific.citations.find(c=>c.kind==='law').article,/^제14조의2/);
});

test('connection check requires approved national and ordinance search AND article access',async()=>{
 const realFetch=global.fetch;const called=[];
 try {
  global.fetch=async (url,init)=>{
   const u=new URL(url);const kind=u.searchParams.get('target');called.push(kind+':'+u.pathname.split('/').pop());
   assert.equal(u.searchParams.get('OC'),'synthetic-oc');
   assert.equal(init.headers.Referer,'https://shield.example/');
   assert.equal(init.headers.Accept,'application/json');
   if(u.pathname.endsWith('lawSearch.do'))return Response.json(kind==='eflaw'?{법령:[{법령ID:'1',법령명한글:'폐기물관리법'}]}:{자치법규:[{자치법규ID:'99',자치법규명:'청주시 음식물류 폐기물 관리 조례'},{자치법규ID:'2',자치법규명:'청주시 폐기물 관리에 관한 조례'}]});
   if(kind==='ordin')assert.equal(u.searchParams.get('ID'),'2');
   return Response.json({기본정보:{[kind==='eflaw'?'법령명_한글':'자치법규명']:kind==='eflaw'?'폐기물관리법':'청주시 폐기물 관리에 관한 조례',시행일자:'20200101'},조문:[{조문번호:'1',조문내용:'가상 연결 검증 조문'}]});
  };
  assert.equal(await exportsObj.testLawConnection('synthetic-oc'),true);
  assert.deepEqual(called.sort(),['eflaw:lawSearch.do','eflaw:lawService.do','ordin:lawSearch.do','ordin:lawService.do'].sort());
  global.fetch=async()=>Response.json({error:'not authorized'});
  await assert.rejects(exportsObj.testLawConnection('synthetic-oc'),/검색 응답/);
 }finally{global.fetch=realFetch;}
});

test('law requests require a configured service origin and never transmit embedded credentials',async()=>{
 const realFetch=global.fetch;const previous=process.env.SERVICE_LAW_ORIGIN;
 try {
  global.fetch=async()=>{throw new Error('Invalid service origin must be rejected before network access');};
  for(const origin of ['', 'not-a-url', 'http://shield.example', 'https://user:password@shield.example']){
   process.env.SERVICE_LAW_ORIGIN=origin;
   await assert.rejects(exportsObj.searchOfficial('synthetic-oc','폐기물관리법','law'),/서비스 주소 설정/);
  }
 }finally{process.env.SERVICE_LAW_ORIGIN=previous;global.fetch=realFetch;}
});

test('official HTTP 200 error envelopes are surfaced rather than empty search results',async()=>{
 const realFetch=global.fetch;
 try {
  for(const [payload,expected] of [
   [{result:'필수입력요소 검증에 실패하였습니다.',msg:'필수 입력값이 존재하지 않습니다. 요청 URL을 확인해 주세요.'},/요청 입력값/],
   [{result:'사용자 정보 검증에 실패하였습니다.',msg:'정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.'},/사용자 인증/],
   [{result:'이용이 제한되었습니다.',msg:'요청 제한'},/조회 요청을 거부/],
  ]) {
   global.fetch=async()=>Response.json(payload);
   await assert.rejects(exportsObj.searchOfficial('synthetic-oc','폐기물관리법','law'),expected);
  }
  global.fetch=async()=>Response.json({법령:[{법령ID:'1',법령명한글:'가상 인증 실패 대응법'}]});
  assert.equal((await exportsObj.searchOfficial('synthetic-oc','인증','law')).length,1);
 }finally{global.fetch=realFetch;}
});

test('historical retrieval uses the version effective on the incident date and its exclusive end date',()=>{
 const old=doc('old',{source_id:'same-law',version_mst:'100',effective_date:'2019-01-01',valid_to:'2021-01-01',articles:JSON.stringify([{number:'제1조',title:'폐기물',text:'과거 폐기물 쓰레기 수거 조문',effectiveDate:'2019-01-01'}])});
 const current=doc('current',{source_id:'same-law',version_mst:'200',effective_date:'2021-01-01',articles:JSON.stringify([{number:'제1조',title:'폐기물',text:'현재 폐기물 쓰레기 수거 조문',effectiveDate:'2021-01-01'}])});
 assert.match(retrieve([current,old],{...input,occurred_at:'2020-06-01'}).citations[0].text,/과거/);
 assert.match(retrieve([old,current],{...input,occurred_at:'2021-01-01'}).citations[0].text,/현재/);
 assert.equal(retrieve([old],{...input,occurred_at:'2021-01-01'}).citations.length,0);
});
