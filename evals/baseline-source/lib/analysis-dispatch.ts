import { start } from 'workflow/api';
import { analyzeComplaint } from '../workflows/analyze-complaint';
import { AppError,database,now } from './server';
export async function startAnalysis(id:string) {
  const claim='dispatch:'+crypto.randomUUID();
  const row=await database().prepare("UPDATE complaints SET workflow_run=?,auto_started_at=? WHERE id=? AND workflow_run IS NULL AND deleted_at IS NULL AND status!='resolved' RETURNING analysis_generation").bind(claim,now(),id).first<{analysis_generation:number}>();
  if(!row)return;
  try {
    const run=await start(analyzeComplaint,[id,row.analysis_generation]);
    await database().prepare('UPDATE complaints SET workflow_run=? WHERE id=? AND analysis_generation=? AND workflow_run=?').bind(run.runId,id,row.analysis_generation,claim).run();
  }catch{await database().prepare("UPDATE complaints SET workflow_run=NULL,auto_state='failed',auto_message='분석 시작을 예약하지 못했습니다. 다시 분석해 주세요.' WHERE id=? AND analysis_generation=? AND workflow_run=?").bind(id,row.analysis_generation,claim).run();throw new AppError('민원은 저장했지만 분석을 시작하지 못했습니다. 접수함에서 다시 분석해 주세요.',503);}
}
