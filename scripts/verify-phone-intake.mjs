import {writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const id=process.argv[2];if(!/^SS-[A-F0-9]{12}$/.test(id||''))throw new Error('Complaint_ID_required');
const origin='https://shield-solve-staff.vercel.app';
const ticket=await fetch(origin+'/api/phone',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'});
if(!ticket.ok)throw new Error('Fresh_session_failed');
const cookie=ticket.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
if(!cookie)throw new Error('New_guest_cookie_missing');
let complaint;const deadline=Date.now()+120000;
while(Date.now()<deadline){
  const response=await fetch(origin+'/api/complaints/'+id,{headers:{Cookie:cookie},cache:'no-store'});
  const data=await response.json();if(!response.ok)throw new Error('Complaint_read_'+response.status);complaint=data.complaint;
  if(['completed','failed','blocked'].includes(complaint.auto_state))break;
  await delay(3000);
}
const result={id,synthetic:complaint.is_sample===1,state:complaint.auto_state,channel:complaint.channel,candidates:complaint.evidence?.citations?.length||0,citations:complaint.analysis?.citations?.length||0,checks:{freshGuestCanRead:!!complaint.id,voiceChannel:complaint.channel==='phone',sampleLabel:complaint.is_sample===1,automaticAnalysis:complaint.auto_state==='completed',lawGrounding:!!complaint.analysis?.citations?.length}};
result.passed=Object.values(result.checks).every(Boolean);
await writeFile('outputs/phone-runtime/verification-intake.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
if(!result.passed)process.exitCode=1;
