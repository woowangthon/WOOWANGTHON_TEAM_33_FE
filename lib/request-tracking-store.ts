import {AppError,database,now} from './server';
import type {Complaint,RequestTracking,Supplement} from './types';
export async function saveTracking(c:Complaint,owner:string,tracking:RequestTracking,label:string,reanalyze:boolean,supplement?:Supplement) {
  const supplements=[...(c.supplements||[]),...(supplement?[supplement]:[])];
  if(supplements.length>40)throw new AppError('보완 이력이 최대 개수에 도달했습니다.',409);
  const time=now();
  const row=await database().prepare(`WITH changed AS (
    UPDATE complaints SET request_tracking=?,supplements=?,updated_at=?,revision=revision+1
    ${reanalyze?",status='reviewing',draft_review=NULL,coverage_review=NULL,analysis_generation=analysis_generation+1,analysis_checkpoint=NULL,workflow_run=NULL,auto_token=NULL,auto_state='queued',auto_message=''":''}
    WHERE id=? AND owner=? AND revision=? AND deleted_at IS NULL RETURNING id,owner
  ), log AS (INSERT INTO events(id,complaint_id,owner,label,created_at) SELECT ?,id,owner,?,? FROM changed)
  SELECT id FROM changed`).bind(JSON.stringify(tracking),JSON.stringify(supplements),time,c.id,owner,c.revision,crypto.randomUUID(),label,time).first();
  if(!row)throw new AppError('다른 창에서 민원이 변경되었습니다. 새로고침 후 다시 저장해 주세요.',409);
}
