import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 이 파일은 원문 사례에 메타데이터를 붙여 JSONL과 CSV를 재생성합니다.
const source = JSON.parse(await fs.readFile(path.join(root,'scripts/source_cases.json'),'utf8'));
const categoryNames = {normal:'일반 민원', criticism:'강한 항의', direct_abuse:'직원 대상 욕설'};
const records=source.map(r=>{
 const profane=[...r.text.matchAll(/개새끼야|개새끼|이 새끼야|병신아|병신|씨발/g)].map(m=>({text:m[0],start_char:m.index,end_char:m.index+m[0].length}));
 return {...r,category_ko:categoryNames[r.category],has_profanity:profane.length>0,direct_attack:r.category==='direct_abuse',expected_protect:r.category==='direct_abuse',summary_should_be_empty:r.must_preserve.length===0,profanity_spans:profane,source:'original_synthetic_script',annotation_status:'AI-authored_reference_not_independently_human_validated',synthetic_audio:true,human_audio_reviewed:false};
});
const order=['normal','criticism','direct_abuse'];
records.sort((a,b)=>order.indexOf(a.category)-order.indexOf(b.category)||a.scenario_id.localeCompare(b.scenario_id));
records.forEach((r,i)=>{r.id=`MV-${String(i+1).padStart(3,'0')}`;r.audio_path=`audio/${r.id}.wav`;});
await fs.mkdir(path.join(root,'data'),{recursive:true});
await fs.mkdir(path.join(root,'audio'),{recursive:true});
await fs.writeFile(path.join(root,'data/dataset.json'),JSON.stringify(records,null,2)+'\n');
await fs.writeFile(path.join(root,'data/dataset.jsonl'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
const headers=['id','scenario_id','category','text','reference_summary','must_preserve','has_profanity','direct_attack','expected_protect','summary_should_be_empty','audio_path','actual_summary','actual_has_profanity','actual_direct_attack','summary_ok','notes'];
const csvCell=x=>'"'+String(x??'').replaceAll('"','""')+'"';
const rows=records.map(r=>headers.map(k=>csvCell(k==='must_preserve'?r[k].join(' | '):r[k])).join(','));
await fs.writeFile(path.join(root,'data/evaluation.csv'),'\ufeff'+[headers.join(','),...rows].join('\r\n')+'\r\n');
console.log(JSON.stringify({records:records.length,scenarios:new Set(records.map(r=>r.scenario_id)).size,counts:Object.fromEntries(order.map(k=>[k,records.filter(r=>r.category===k).length])),pureAbuse:records.filter(r=>r.summary_should_be_empty).length}));
