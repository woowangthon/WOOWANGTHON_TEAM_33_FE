import { OFFICE, officeForOwner, officeScope } from "./access";
import {
  AppError,
  database,
  credentials,
  decodeComplaint,
  eventStatement,
  now,
  rateLimit,
} from "./server";
import { autoSync, retrieve, type StoredDoc } from "./laws";
import { generateAnalysis } from "./ai";
import { verifyDraft } from './review';
import type { DraftReview } from './types';

// A persisted queue and atomic lease make repeated after() callbacks safe.
// Interrupted leases are retried when the authenticated workspace is next opened.
export async function queueAnalysis(id: string) {
  const stale = new Date(Date.now() - 240000).toISOString();
  const result = await database()
    .prepare(
      "UPDATE complaints SET auto_state='queued',auto_message='접수 내용을 기준으로 법령 검색과 분석을 준비합니다.',auto_token=NULL,workflow_run=NULL,analysis_generation=analysis_generation+1,analysis_checkpoint=CASE WHEN auto_state='failed' THEN analysis_checkpoint ELSE NULL END WHERE id=? AND deleted_at IS NULL AND status!='resolved' AND (auto_state!='processing' OR auto_started_at<?)",
    )
    .bind(id, stale)
    .run();
  if (!result.meta.changes)
    throw new AppError(
      "이미 자동 분석 중이거나 답변이 완료된 민원입니다.",
      409,
    );
}

export async function processComplaint(id: string) {
  const token = crypto.randomUUID();
  const stale = new Date(Date.now() - 240000).toISOString();
  const row = await database()
    .prepare(
      "UPDATE complaints SET auto_state='processing',auto_message='공식 법령·조례를 검색하고 있습니다.',auto_started_at=?,auto_token=? WHERE id=? AND deleted_at IS NULL AND status!='resolved' AND (auto_state='queued' OR (auto_state='processing' AND auto_started_at<?)) RETURNING *",
    )
    .bind(now(), token, id, stale)
    .first<Record<string, unknown>>();
  if (!row) return;
  const c = decodeComplaint(row);
  const owner = String(row.owner);
  const office = officeForOwner(owner);
  const finish = async (state: string, message: string) => {
    await database().batch([
      database()
        .prepare(
          "UPDATE complaints SET auto_state=?,auto_message=?,auto_token=NULL WHERE id=? AND auto_token=?",
        )
        .bind(state, message, id, token),
      eventStatement(owner, id, "자동 처리: " + message),
    ]);
  };
  try {
    const keys = await credentials(office);
    const aiKey = keys.provider === 'openai' ? keys.openai : keys.gemini;
    if (!aiKey && !keys.law) {
      await finish(
        "blocked",
        "분석 서비스가 준비 중입니다.",
      );
      return;
    }
    await rateLimit(office, "automatic", 60);
    const notes = keys.law
      ? await autoSync(office, keys.law, c.category, c)
      : ["법령 API가 연결되지 않아 저장된 공식 자료만 검색했습니다."];
    const docs = await database()
      .prepare("SELECT * FROM documents WHERE owner=?")
      .bind(office)
      .all<StoredDoc>();
    const search = retrieve(docs.results, c);
    const evidence = {
      ...search,
      warnings: [...notes, ...search.warnings],
      generatedAt: now(),
    };
    await database()
      .prepare(
        "UPDATE complaints SET evidence=?,draft_review=NULL,auto_message='민원 요구사항과 답변 초안을 정리하고 있습니다.' WHERE id=? AND auto_token=? AND status!='resolved'",
      )
      .bind(JSON.stringify(evidence), id, token)
      .run();
    if (!aiKey) {
      await finish(
        "blocked",
        "법령 근거를 저장했습니다. 요약·답변 생성이 대기 중입니다.",
      );
      return;
    }
    const analysis = await generateAnalysis(
      aiKey,
      keys.model,
      c,
      search.citations,
      evidence.warnings,
      search.mode,
      keys.provider,
    );
    let draftReview:DraftReview;
    try {draftReview=await verifyDraft(aiKey,keys.model,keys.provider,analysis.draft,search.citations);}
    catch {draftReview={draft:analysis.draft,status:'unavailable',sentences:[],checkedAt:now()};}
    // Read the latest draft after the network calls; never overwrite staff edits or approvals.
    const current = await database()
      .prepare("SELECT * FROM complaints WHERE id=? AND auto_token=?")
      .bind(id, token)
      .first<Record<string, unknown>>();
    if (!current) return;
    const latest = decodeComplaint(current);
    if (latest.status === "resolved") {
      await finish(
        "completed",
        "담당자가 답변을 등록하여 자동 분석 결과는 반영하지 않았습니다.",
      );
      return;
    }
    const tasks = latest.tasks.length
      ? latest.tasks
      : analysis.actions.map((label) => ({
          id: crypto.randomUUID(),
          label,
          done: false,
        }));
    const replaceDraft=!latest.draft||latest.draft===latest.analysis?.draft;
    const updated = await database()
      .prepare(
        "UPDATE complaints SET analysis=?,draft=?,draft_review=?,tasks=?,status=?,updated_at=?,revision=revision+1 WHERE id=? AND auto_token=? AND revision=? AND status!='resolved'",
      )
      .bind(
        JSON.stringify(analysis),
        replaceDraft ? analysis.draft : latest.draft,
        replaceDraft ? JSON.stringify(draftReview) : latest.draft_review ? JSON.stringify(latest.draft_review) : null,
        JSON.stringify(tasks),
        latest.status === "received" ? "reviewing" : latest.status,
        now(),
        id,
        token,
        latest.revision,
      )
      .run();
    if (!updated.meta.changes)
      throw new AppError(
        "담당자 수정과 겹쳐 결과 반영을 중단했습니다. 다시 분석해 주세요.",
        409,
      );
    if (!keys.law) {
      await finish(
        "blocked",
        "요약·답변 초안을 저장했습니다. 공식 근거 확인이 대기 중입니다.",
      );
      return;
    }
    if (notes.length) {
      await finish(
        "failed",
        "분석은 저장했지만 일부 법령 수집에 실패했습니다. 근거 경고를 확인하고 재시도해 주세요.",
      );
      return;
    }
    if(draftReview.status==='unavailable') {
      await finish('failed','분석과 초안은 저장했습니다. 답변의 문장별 근거 검증을 다시 실행해 주세요.');return;
    }
    await finish(
      "completed",
      "법령 검색·분석 완료. 담당자의 근거 검토와 답변 승인을 기다립니다.",
    );
  } catch (error) {
    await finish(
      "failed",
      error instanceof AppError
        ? error.message
        : "자동 분석을 완료하지 못했습니다. 접수 원문은 보존되어 있으며 다시 시도할 수 있습니다.",
    );
  }
}

export async function drainAnalysisQueue(office = OFFICE) {
  const keys = await credentials(office);
  if ((keys.provider==='openai' ? keys.openai : keys.gemini) && keys.law) await resumeAfterConfiguration(office);
  const guest = office.startsWith("guest:");
  const stale = new Date(Date.now() - 240000).toISOString();
  const pending = await database()
    .prepare(
      `SELECT id FROM complaints WHERE ${officeScope(office)} AND deleted_at IS NULL AND status!='resolved' AND workflow_run IS NULL AND (auto_state='queued' OR (auto_state='processing' AND auto_started_at<?)) ORDER BY created_at LIMIT 2`,
    )
    .bind(...(guest ? [office, stale] : [stale]))
    .all<{ id: string }>();
  const {startAnalysis}=await import('./analysis-dispatch');
  await Promise.all(pending.results.map((c) => startAnalysis(c.id)));
}

export async function resumeAfterConfiguration(office = OFFICE) {
  const guest = office.startsWith("guest:");
  await database()
    .prepare(
      `UPDATE complaints SET auto_state='queued',auto_message='자동 분석을 재개합니다.' WHERE ${officeScope(office)} AND deleted_at IS NULL AND auto_state='blocked' AND status!='resolved'`,
    )
    .bind(...(guest ? [office] : []))
    .run();
}
