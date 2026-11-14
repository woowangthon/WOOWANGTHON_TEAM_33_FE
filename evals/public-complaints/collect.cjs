// Public source acquisition only. No AI calls, service credentials, or database.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const manifest=require('./sources.json');
const destination=path.resolve(process.argv[2]||'../acrc-evaluation');
function text(html){return html.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16))).replace(/&nbsp;/g,' ').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/\r/g,'').trim();}
function extract(html,section){
 const heading=new RegExp('<h4[^>]*>\\s*'+section+'\\s*</h4>','g'),match=heading.exec(html);
 if(!match)throw Error('Required source section missing');
 const rest=html.slice(match.index+match[0].length),end=rest.search(/<h4\b|<div\s+class="btn/i);
 if(end<0)throw Error('Source section boundary missing');
 const body=text(rest.slice(0,end));if(body.length<30||body.length>18000)throw Error('Invalid source section length');return body;
}
module.exports={text,extract};
async function collect(){
 fs.mkdirSync(path.join(destination,'originals'),{recursive:true});
 const records=[];
 for(const entry of manifest.cases){
  const url=`https://www.acrc.go.kr/board.es?act=view&bid=1011&list_no=${entry.listNo}&mid=a10504010000`;
  const response=await fetch(url,{signal:AbortSignal.timeout(25000)});if(!response.ok)throw Error(`Public source HTTP ${response.status}`);
  const html=await response.text(),body=extract(html,entry.section);
  const title=text((html.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]||'').split('|')[0].trim();if(!title)throw Error('Source title missing');
  const licenseMark=(html.match(/alt="([^"]*(?:공공누리|공공저작물)[^"]*)"/i)||[])[1]||null;
  const hash=crypto.createHash('sha256').update(html).digest('hex');fs.writeFileSync(path.join(destination,'originals',entry.id+'.html'),html);
  const complaint={title,body,category:entry.category,location:'',occurred_at:''};
  records.push({...entry,synthetic:false,complaint,provenance:{url,section:entry.section,retrievedAt:new Date().toISOString(),htmlSha256:hash,bodySha256:crypto.createHash('sha256').update(body).digest('hex'),licenseMark,apiCatalog:manifest.apiCatalog,acquiredVia:'official_public_web',redistributionApproved:false,transformation:'HTML 태그·문자 참조만 텍스트로 변환. 문장 추가·문체 변경 없음. 위치·발생일 필드는 추측하지 않고 빈칸으로 유지.'}});
  console.log(`${entry.id}: ${title} (${body.length} chars)`);
  fs.writeFileSync(path.join(destination,'real-complaints.json'),JSON.stringify({manifest,collectedAt:new Date().toISOString(),cases:records},null,2));
 }
 console.log(`Collected ${records.length} real published complaint excerpts. No database writes.`);
}
if(require.main===module)collect().catch(error=>{console.error(error.message);process.exitCode=1;});
