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
new Function('require','exports',js)(name=>{if(name==='./harness-policy')return require('../evals/loader.cjs')()('lib/harness-policy.ts');if(name==='./protection')return protection;if(name==='./server')return {AppError,now:()=>new Date().toISOString(),database:()=>{throw new Error('No live database in pure retrieval tests');}};throw new Error(name);},exportsObj);
const {parseOfficialDocument,retrieve}=exportsObj;
test('offline search plans do not invent category-specific laws or example answers',()=>{
 for(const category of ['생활폐기물','도로·교통','기타']){
  const plan=exportsObj.searchPlan(category,{title:'가상 현장 점검',body:'시설 상태 확인 요청'});
  assert.deepEqual(plan.sources,[]);assert.deepEqual(plan.profiles,[]);assert.ok(plan.terms.includes('시설'));
 }
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

test('renaming equally relevant laws cannot change their retrieval scores',()=>{
 const article={number:'제1조',title:'시설 점검',text:'시설 상태 점검 확인 요청',effectiveDate:'2020-01-01'};
 const base=doc('one',{title:'임의의 가상법',articles:JSON.stringify([article])});
 const query={...input,title:'시설 점검',body:'시설 상태 확인 요청'};
 const plan={profiles:[],sources:[],terms:['시설','점검']};
 const a=retrieve([base],query,plan),b=retrieve([{...base,title:'폐기물관리법'}],query,plan);
 assert.equal(a.citations.length,1);assert.equal(b.citations.length,1);assert.equal(a.citations[0].text,b.citations[0].text);
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
