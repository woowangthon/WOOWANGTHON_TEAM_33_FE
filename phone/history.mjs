import {createHmac,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import {dirname} from 'node:path';

// Store only the protected transcript, never audio or the raw account identifier.
export function createCallHistory({file,secret,retentionDays=30}) {
  let data={version:1,callers:{},calls:[]},pending=Promise.resolve();
  if(file)try{data=JSON.parse(readFileSync(file,'utf8'));if(data.version!==1||!data.callers||!Array.isArray(data.calls))throw Error('Invalid_phone_history');}catch(error){if(error.code!=='ENOENT')throw error;}
  const cutoff=()=>Date.now()-retentionDays*86400000;
  data.calls=data.calls.filter(c=>Date.parse(c.startedAt)>=cutoff());
  for(const c of data.calls)if(c.status!=='ended'){c.status='ended';c.finalizing=false;c.typing={caller:false,staff:false};c.reason='연결이 종료되었습니다.';}
  function save(){
    if(!file)return;
    const content=JSON.stringify(data);
    pending=pending.catch(()=>{}).then(async()=>{await mkdir(dirname(file),{recursive:true});const tmp=file+'.tmp';await writeFile(tmp,content,{mode:0o600});await rename(tmp,file);});
    void pending.catch(()=>console.error('Phone history could not be saved.'));
  }
  return {
    identify(owner,nickname,source){
      const callerId=createHmac('sha256',secret).update('phone-caller:'+String(owner||randomUUID())).digest('hex');
      if(source==='demo')return{callerId,callerName:nickname||'민원인',callerCallNumber:0};
      const previous=data.callers[callerId];
      const caller={name:nickname||previous?.name||'민원인',count:(previous?.count||0)+1};
      data.callers[callerId]=caller;save();
      return{callerId,callerName:caller.name,callerCallNumber:caller.count};
    },
    count(callerId){return data.callers[callerId]?.count||0;},
    remember(call){
      if(call.source==='demo')return;
      const snapshot=structuredClone(call);
      data.calls=data.calls.filter(c=>c.id!==snapshot.id&&Date.parse(c.startedAt)>=cutoff());
      data.calls.push(snapshot);save();
    },
    list(){return data.calls.filter(c=>Date.parse(c.startedAt)>=cutoff()).map(c=>({...c,callerCallCount:data.callers[c.callerId]?.count||c.callerCallNumber}));},
    flush(){return pending;}
  };
}
