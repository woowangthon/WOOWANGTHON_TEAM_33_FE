const {text}=require('./collect.cjs');
const normalize=s=>s.replace(/\u00a0/g,' ').replace(/\r/g,'').trim();
function ddmSnapshot(snapshot){
 const section=snapshot.split('### 민원내용\n')[1]?.split('\n### 답변')[0];
 const marker=section&&/첨부파일\s*\|[^\n]*\n/.exec(section);
 if(!marker)throw Error('Municipal complaint body missing from source snapshot');
 const body=normalize(section.slice(marker.index+marker[0].length));if(body.length<50)throw Error('Incomplete municipal source');return body;
}
function dobongSnapshot(snapshot){
 const start=/\n\d+\.\s*안녕/.exec(snapshot),end=snapshot.indexOf('\n### 민원 답변 내용');
 if(!start||end<=start.index)throw Error('Municipal complaint section boundaries missing');
 return normalize(snapshot.slice(start.index,end));
}
function gijangHtml(html){
 const section=/<td[^>]*style="[^"]*white-space:\s*pre-wrap[^"]*"[^>]*>([\s\S]*?)<\/td>/i.exec(html)?.[1];
 if(!section)throw Error('Municipal complaint HTML section missing');
 return normalize(text(section.replace(/<\/p>/gi,'\n')));
}
module.exports={ddmSnapshot,dobongSnapshot,gijangHtml};
