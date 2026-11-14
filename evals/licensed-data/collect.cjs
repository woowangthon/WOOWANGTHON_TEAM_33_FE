// Public source collection only: no OpenAI request, production DB or web publication.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const manifest=require('./sources.json');
const folder=path.resolve(process.env.LICENSED_DATA_DIR||path.join(__dirname,'../../../licensed-data'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function get(url,options){const r=await fetch(url,{...options,signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Source HTTP '+r.status);return r;}
async function post(url,body){return get(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Referer':manifest.sources[0].url,'X-Requested-With':'XMLHttpRequest'},body:new URLSearchParams(body)});}
function csv(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
  else if(c===','&&!quoted){row.push(field);field='';}
  else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';}
  else field+=c;
 }
 if(quoted)throw Error('Incomplete CSV');if(field||row.length){row.push(field);rows.push(row);}return rows;
}
async function main(){
 fs.mkdirSync(folder,{recursive:true});const collectedAt=new Date().toISOString();
 const page=await(await get(manifest.sources[0].url)).text();
 const metadata=JSON.parse(page.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)?.[1]||'null');
 if(metadata?.identifier!=='15093026'||metadata.license?.name!=='이용허락범위 제한 없음')throw Error('Source identity or reuse permission changed; review before using');
 fs.writeFileSync(path.join(folder,'koen-license-page.html'),page);
 const link=page.match(/fn_fileDataDown\('15093026',\s*'([^']+)',\s*'([^']*)',\s*'([^']+)'/);
 if(!link)throw Error('Official file download control missing');
 const info=await(await post('https://www.data.go.kr/tcs/dss/selectFileDataDownload.do',{publicDataPk:'15093026',publicDataDetailPk:link[1],atchFileId:link[2],fileDetailSn:link[3],publicDataTyCode:'PR0051'})).json();
 if(!info.status||!info.atchFileId||info.fileDataRegistVO?.atchFileExtsn!=='csv')throw Error('Official CSV unavailable');
 const permission=await(await post('https://www.data.go.kr/cmm/cmm/check-limit.json',{atchFileId:info.atchFileId,fileDetailSn:info.fileDetailSn})).json();
 if(permission.needCaptcha!==false)throw Error('Download requires user verification; collection stopped');
 const url=new URL('https://www.data.go.kr/cmm/cmm/fileDownload.do');url.search=new URLSearchParams({atchFileId:info.atchFileId,fileDetailSn:info.fileDetailSn,dataNm:info.fileDataRegistVO.dataNm});
 const bytes=Buffer.from(await(await get(url)).arrayBuffer());
 const rows=csv(new TextDecoder('euc-kr',{fatal:true}).decode(bytes));
 if(JSON.stringify(rows.shift())!==JSON.stringify(['민원접수일','민원내용','처리내용'])||rows.length!==13||rows.some(r=>r.length!==3||!/^\d{4}-\d{2}-\d{2}$/.test(r[0])||!r[1]))throw Error('CSV shape changed; inspect new version');
 fs.writeFileSync(path.join(folder,'koen.csv'),bytes);
 const records=rows.map((r,i)=>({id:'KOEN-'+String(i+1).padStart(3,'0'),receivedAt:r[0],complaintContent:r[1],agencyResponse:r[2]}));
 fs.writeFileSync(path.join(folder,'licensed-complaints.json'),JSON.stringify({source:manifest.sources[0],collectedAt,csvSha256:hash(bytes),records},null,2));
 const source=manifest.sources[1],raw='https://raw.githubusercontent.com/2runo/Curse-detection-data/'+source.version+'/';
 const license=await(await get(raw+'LICENSE')).text(),readme=await(await get(raw+'README.md')).text(),dataset=await(await get(raw+'dataset.txt')).text();
 if(!license.includes('MIT License')||!license.includes(source.copyright))throw Error('MIT notice missing');
 fs.writeFileSync(path.join(folder,'LICENSE-2runo.txt'),license);fs.writeFileSync(path.join(folder,'README-2runo.txt'),readme);fs.writeFileSync(path.join(folder,'curse-dataset.txt'),dataset);
 const comments=dataset.split(/\r?\n/).filter(Boolean).map((line,i)=>{const at=line.lastIndexOf('|');if(at<0||!/^\s*[01]\s*$/.test(line.slice(at+1)))throw Error('Invalid labeled comment');return{id:'2RUNO-L'+(i+1),sourceLine:i+1,text:line.slice(0,at),originalLabel:Number(line.slice(at+1))};});
 if(comments.length!==source.records)throw Error('Pinned dataset row count mismatch');
 fs.writeFileSync(path.join(folder,'licensed-comments.json'),JSON.stringify({source,collectedAt,datasetSha256:hash(dataset),records:comments},null,2));
 fs.writeFileSync(path.join(folder,'provenance.json'),JSON.stringify({collectedAt,sources:[{...manifest.sources[0],fileUrl:url.href,csvSha256:hash(bytes),pageSha256:hash(page),metadata},{...source,datasetSha256:hash(dataset),licenseSha256:hash(license)}]},null,2));
 console.log(JSON.stringify({complaints:records.length,comments:comments.length,folder,licenseVerified:true}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={csv};
