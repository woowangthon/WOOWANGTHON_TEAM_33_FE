import { AppError,database,now } from './server';
import type { Complaint,Supplement } from './types';
export function imageMime(bytes:Uint8Array) {
  if(bytes.length>=8&&[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return 'image/png';
  if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=12&&Buffer.from(bytes.slice(0,4)).toString()==='RIFF'&&Buffer.from(bytes.slice(8,12)).toString()==='WEBP')return 'image/webp';
  return '';
}
export async function addSupplement(request:Request,c:Complaint,owner:string,staff:boolean) {
  if(c.status==='resolved'||c.deleted_at)throw new AppError('완료되거나 삭제된 민원은 보완할 수 없습니다.',409);
  let text='',revision=-1;const files:{id:string;name:string;mime:string;size:number;data:string}[]=[];
  if(staff){const input=await request.json();text=String(input.text||'').trim();revision=Number(input.revision);}
  else {
    if(c.status!=='waiting'||c.supplements?.at(-1)?.role!=='staff')throw new AppError('보완 요청을 받은 민원에 답변할 수 있습니다.',409);
    const form=await request.formData();text=String(form.get('text')||'').trim();revision=Number(form.get('revision'));
    const inputs=form.getAll('photos');
    if(inputs.length>3)throw new AppError('사진은 최대 3장까지 첨부할 수 있습니다.');
    for(const input of inputs){
      if(!(input instanceof File)||!input.size||input.size>1000000)throw new AppError('사진은 장당 1MB 이하로 첨부해 주세요.');
      const bytes=Buffer.from(await input.arrayBuffer()),mime=imageMime(bytes);
      if(!mime||mime!==input.type)throw new AppError('JPG, PNG, WebP 사진만 첨부할 수 있습니다.');
      files.push({id:crypto.randomUUID(),name:input.name.replace(/[\r\n/\\]/g,'_').slice(0,120),mime,size:bytes.length,data:bytes.toString('base64')});
    }
  }
  if(text.length<2||text.length>4000)throw new AppError('보완 내용을 2~4,000자로 입력해 주세요.');
  if(revision!==c.revision)throw new AppError('민원이 변경되었습니다. 새로고침 후 다시 제출해 주세요.',409);
  if((c.supplements?.length||0)>=40)throw new AppError('보완 이력은 최대 40개까지 등록할 수 있습니다.');
  const time=now(),message:Supplement={id:crypto.randomUUID(),role:staff?'staff':'citizen',text,createdAt:time,attachments:files.map(({data:_data,...m})=>m)};
  // The revision change and photo inserts succeed together. A stale request writes neither.
  const result=await database().prepare(`WITH changed AS (
    UPDATE complaints SET supplements=?,status=?,updated_at=?,revision=revision+1,analysis_generation=analysis_generation+1,analysis_checkpoint=NULL,workflow_run=NULL,auto_token=NULL,auto_state=?,auto_message='',draft_review=NULL,coverage_review=NULL
    WHERE id=? AND owner=? AND revision=? AND deleted_at IS NULL AND status!='resolved' RETURNING id,owner
  ), photos AS (
    INSERT INTO complaint_attachments(id,complaint_id,owner,name,mime,bytes,created_at)
    SELECT f.id,c.id,c.owner,f.name,f.mime,decode(f.data,'base64'),? FROM changed c CROSS JOIN jsonb_to_recordset(?::jsonb) AS f(id text,name text,mime text,data text)
  ), log AS (
    INSERT INTO events(id,complaint_id,owner,label,created_at) SELECT ?,id,owner,?,? FROM changed
  ) SELECT id FROM changed`).bind(JSON.stringify([...(c.supplements||[]),message]),staff?'waiting':'reviewing',time,staff?'idle':'queued',c.id,owner,c.revision,time,JSON.stringify(files),crypto.randomUUID(),staff?'담당자 보완 요청':'민원인 보완 답변 접수',time).first();
  if(!result)throw new AppError('다른 창에서 민원이 변경되었습니다. 다시 확인해 주세요.',409);
  return {ok:true};
}
