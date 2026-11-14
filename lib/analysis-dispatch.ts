import { start } from 'workflow/api';
import { analyzeComplaint } from '../workflows/analyze-complaint';
import { AppError,database,now } from './server';
export async function startAnalysis(id:string) {
  const claim='dispatch:'+crypto.randomUUID();
  const row=await database().prepare("UPDATE complaints SET workflow_run=?,auto_started_at=?,auto_state='queued' WHERE id=? AND workflow_run IS NULL AND deleted_at IS NULL AND status!='resolved' AND (auto_state IN ('queued','processing') OR (auto_state='idle' AND analysis IS NULL)) RETURNING analysis_generation").bind(claim,now(),id).first<{analysis_generation:number}>();
  if(!row)return;
  let run;
  try {
    run=await start(analyzeComplaint,[id,row.analysis_generation]);
  }catch{await database().prepare("UPDATE complaints SET workflow_run=NULL,auto_state='failed',auto_message='자동 분석을 시작하지 못했습니다.' WHERE id=? AND analysis_generation=? AND workflow_run=? AND auto_state='queued'").bind(id,row.analysis_generation,claim).run();throw new AppError('민원은 저장했지만 자동 분석을 시작하지 못했습니다.',503);}
  // A bookkeeping failure after dispatch must not release the claim and start a duplicate paid run.
  await database().prepare('UPDATE complaints SET workflow_run=? WHERE id=? AND analysis_generation=? AND workflow_run=?').bind(run.runId,id,row.analysis_generation,claim).run();
}
