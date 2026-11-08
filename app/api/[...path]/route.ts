import { startAnalysis } from "../../../lib/analysis-dispatch";
import {confirmRequests,updateProgress,replyToRequest,seedTracking,TrackingError} from '../../../lib/request-tracking';
import {saveTracking} from '../../../lib/request-tracking-store';
import { addSupplement } from "../../../lib/supplements";
import { inlineReferences } from "../../../lib/citations";
import { supplementedComplaint } from "../../../lib/analysis-stages";
import { semanticPlan,rerank } from "../../../lib/semantic-search";
import { z } from "zod";
import { getCurrentUser } from "../../user";
import { publicStaffInbox, officeForOwner, officeScope, publicComplaint } from "../../../lib/access";
import {
  AppError,
  database,
  now,
  credentials,
  runtime,
  decodeComplaint,
  eventStatement,
  rateLimit,
} from "../../../lib/server";
import {
  autoSync,
  importDocument,
  retrieve,
  searchOfficial,
  type StoredDoc,
} from "../../../lib/laws";
import { categories, statuses } from "../../../lib/types";
import { samples } from "../../../lib/samples";
import { after } from "next/server";
import { verifyDraft, reviewAllowsPublication } from '../../../lib/review';
import {auditRequirements,checkAnswerCoverage} from '../../../lib/coverage-ai';
import {coverageIsCurrent,coverageAllowsPublication,analysisSnapshot} from '../../../lib/coverage';
import {createRecordReport} from '../../../lib/reports';
import {renderReport,type RecordReport} from '../../../lib/report-core';
import {expressionFindings,maskText} from '../../../lib/protection';
import {
  queueAnalysis,
  processComplaint,
  drainAnalysisQueue,
} from "../../../lib/automatic";

export const dynamic = "force-dynamic";
export const maxDuration = 180;
const createSchema = z.object({
  title: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(6000),
  category: z.enum(categories),
  location: z.string().trim().min(2).max(200),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  consent: z.literal(true),
  channel: z.enum(['web','phone']).optional(),
  sample: z.boolean().optional(),
});
function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
async function body(request: Request) {
  const text = await request.text();
  if (text.length > 20000) throw new AppError("입력 크기를 초과했습니다.", 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("올바른 JSON 요청이 필요합니다.");
  }
}
async function addComplaint(
  owner: string,
  input: z.infer<typeof createSchema>,
  sample = false,
) {
  const id =
    "SS-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();
  const time = now();
  await database().batch([
    database()
      .prepare(
        "INSERT INTO complaints (id,owner,title,body,category,location,occurred_at,is_sample,created_at,updated_at,auto_state,channel) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        id,
        owner,
        input.title,
        input.body,
        input.category,
        input.location,
        input.occurredAt,
        sample ? 1 : 0,
        time,
        time,
        "queued",
        input.channel || 'web',
      ),
    eventStatement(
      owner,
      id,
      input.channel==='phone'?(sample?'가상 음성 민원 접수':'음성 민원 접수'):sample?'가상 시나리오 민원 등록':'홈페이지 민원 접수',
    ),
  ]);
  return id;
}
async function handler(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const user = await getCurrentUser();
    if (!user) return json({ error: "작업공간을 다시 열어 주세요." }, 401);
    const owner = user.userId;
    const office = officeForOwner(owner);
    const sharedStaff =
      process.env.SITE_MODE === "staff" && user.isStaff && (!user.isGuest || publicStaffInbox());
    const staff = process.env.SITE_MODE === "staff" && user.isStaff;
    if (process.env.SITE_MODE === "staff" && !staff)
      throw new AppError("승인된 담당자 계정과 이메일 인증이 필요합니다.", 403);
    const { path } = await params;
    const route = path.join("/");
    const method = request.method;
    const url = new URL(request.url);
    const photoUpload=path[0]==="complaints"&&path[2]==="supplements"&&!staff&&method==="POST";
    if (method !== "GET") {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin)
        throw new AppError("허용되지 않은 요청 출처입니다.", 403);
      if (!request.headers.get("content-type")?.includes(photoUpload?"multipart/form-data":"application/json"))
        throw new AppError("JSON 요청만 지원합니다.", 415);
      if (Number(request.headers.get("content-length") || 0) > (photoUpload?3200000:20000))
        throw new AppError("입력 크기를 초과했습니다.", 413);
    }
    if (route === "overview" && method === "GET") {
      if (staff) after(() => drainAnalysisQueue(office));
      const trash=staff&&url.searchParams.get("trash")==="1";
      const rows = await (
        sharedStaff
          ? database().prepare(
              `SELECT * FROM complaints WHERE ${officeScope(office)} ORDER BY created_at DESC LIMIT 1200`,
            )
          : database()
              .prepare(
                "SELECT * FROM complaints WHERE owner=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 200",
              )
              .bind(owner)
      ).all<Record<string, unknown>>();
      const keys = staff
        ? await credentials(office)
        : { gemini: "", openai: "", provider: "", law: "", model: "" };
      // Background polls skip the law library; it only changes on explicit import.
      const poll = url.searchParams.get("poll") === "1";
      // Count articles in SQL so the full article text never leaves the database.
      const docs = poll
        ? null
        : staff || user.isGuest
          ? await database()
              .prepare(
                "SELECT id,source_id,title,kind,jurisdiction,effective_date,source_url,imported_at,json_array_length(articles::json) AS article_count FROM documents WHERE owner=? ORDER BY imported_at DESC",
              )
              .bind(office)
              .all<Omit<StoredDoc, "owner" | "articles"> & { article_count: number }>()
          : { results: [] };
      return json({
        trashComplaints:staff?rows.results.filter(r=>r.deleted_at).map(decodeComplaint):[],
        complaints: rows.results.filter(r=>trash?!!r.deleted_at:!r.deleted_at).map((row) =>
          staff ? decodeComplaint(row) : publicComplaint(decodeComplaint(row)),
        ),
        settings: {
          geminiReady: !!keys.gemini,
          aiReady: !!(keys.provider === 'openai' ? keys.openai : keys.gemini),
          aiProviderLabel: runtime.SERVICE_AI_PROVIDER === 'openai' ? 'OpenAI' : 'Google Gemini',
          publicInbox: publicStaffInbox(),
          lawReady: !!keys.law,
          encryptionReady: staff && !!runtime.APP_SECRET,
          model: keys.model,
        },
        ...(docs
          ? {
              documents: docs.results.map(({ article_count, ...d }) => ({
                ...d,
                articleCount: Number(article_count),
              })),
            }
          : {}),
        user: { name: user.fullName || user.email },
      });
    }
    if (route === "complaints" && method === "POST") {
      await rateLimit(owner, "create", 60);
      const input = createSchema.parse(await body(request));
      if(input.channel==='phone'&&!staff)throw new AppError('전화 민원은 담당자가 접수합니다.',403);
      if (
        input.occurredAt >
          new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Seoul",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date()) ||
        Number.isNaN(Date.parse(input.occurredAt)) ||
        new Date(input.occurredAt).toISOString().slice(0, 10) !==
          input.occurredAt
      )
        throw new AppError("발생일을 확인해 주세요.");
      const count = await database()
        .prepare("SELECT count(*) AS n FROM complaints WHERE owner=? AND deleted_at IS NULL")
        .bind(owner)
        .first<{ n: number }>();
      if ((count?.n || 0) >= 200)
        throw new AppError(
          "작업공간당 최대 200건까지 접수할 수 있습니다.",
          409,
        );
      const id = await addComplaint(owner, input, staff && input.sample===true);
      await startAnalysis(id).catch(()=>undefined);
      return json({ id, processing: "queued" }, 201);
    }
    if (route === "samples" && method === "POST") {
      if (!staff) throw new AppError("담당자 권한이 필요합니다.", 403);
      const existing = await database()
        .prepare(
          "SELECT id FROM complaints WHERE owner=? AND is_sample=1 AND deleted_at IS NULL LIMIT 1",
        )
        .bind(owner)
        .first();
      if (existing)
        return json({ message: "이미 가상 사례가 등록되어 있습니다." });
      for (const sample of samples)
        await addComplaint(
          owner,
          {
            ...sample,
            category: sample.category as (typeof categories)[number],
            occurredAt: now().slice(0, 10),
            consent: true,
          },
          true,
        );
      after(() => drainAnalysisQueue(office));
      return json({ message: "가상 민원 6건을 등록했습니다." });
    }
    if (path[0] === "complaints" && path[1]) {
      const row = await (
        sharedStaff
          ? database()
              .prepare(
                `SELECT * FROM complaints WHERE id=? AND ${officeScope(office)}`,
              )
              .bind(path[1])
          : database()
              .prepare("SELECT * FROM complaints WHERE id=? AND owner=? AND deleted_at IS NULL")
              .bind(path[1], owner)
      ).first<Record<string, unknown>>();
      if (!row) throw new AppError("민원을 찾을 수 없습니다.", 404);
      const c = decodeComplaint(row);
      if(c.deleted_at&&!(staff&&(url.searchParams.get("trash")==="1"||method==="PATCH")))throw new AppError("민원을 찾을 수 없습니다.",404);
      const complaintOwner = String(row.owner);
      if (path.length === 2 && method === "GET") {
        const events = await database()
          .prepare(
            "SELECT id,label,created_at FROM events WHERE complaint_id=? AND owner=? ORDER BY created_at DESC",
          )
          .bind(c.id, complaintOwner)
          .all();
        return json({
          complaint: staff ? c : publicComplaint(c),
          events: staff
            ? events.results
            : events.results.filter(
                (e) =>
                  String(e.label).includes("민원 접수") ||
                  String(e.label).includes("홈페이지 답변 등록") ||
                  String(e.label).startsWith("처리 상태 변경"),
              ),
        });
      }
      if(path[2]==='attachments'&&path[3]&&method==='GET') {
        const photo=await database().prepare('SELECT mime,bytes FROM complaint_attachments WHERE id=? AND complaint_id=? AND owner=?').bind(path[3],c.id,complaintOwner).first<{mime:string;bytes:Buffer}>();
        if(!photo)throw new AppError('사진을 찾을 수 없습니다.',404);
        return new Response(new Uint8Array(photo.bytes),{headers:{'Content-Type':photo.mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
      }
      if(path[2]==='supplements'&&method==='POST') {
        await rateLimit(owner,'supplement',30);
        await addSupplement(request,c,complaintOwner,staff);
        if(!staff)await startAnalysis(c.id).catch(()=>undefined);
        return json({ok:true},201);
      }
      if(path[2]==='requirements'&&method==='POST') {
        if(c.deleted_at)throw new AppError('삭제된 민원은 변경할 수 없습니다.',409);
        await rateLimit(owner,'requirements',40);
        const input=z.discriminatedUnion('action',[
          z.object({action:z.literal('confirm'),revision:z.number().int(),items:z.array(z.object({id:z.string().max(60).optional(),text:z.string().trim().min(2).max(600),withdrawn:z.boolean()})).max(30)}),
          z.object({action:z.literal('progress'),revision:z.number().int(),id:z.string().max(60),state:z.enum(['received','waiting','in_progress','completed','unavailable']),note:z.string().trim().min(5).max(2000)}),
          z.object({action:z.literal('reply'),revision:z.number().int(),id:z.string().max(60),text:z.string().trim().min(2).max(2000)})
        ]).parse(await body(request));
        if(input.revision!==c.revision)throw new AppError('민원이 변경되었습니다. 새로고침 후 다시 저장해 주세요.',409);
        const previous=seedTracking(c),time=now();
        if(input.action==='progress'){
          if(!staff)throw new AppError('담당자만 처리 상태를 변경할 수 있습니다.',403);
          await saveTracking(c,complaintOwner,updateProgress(previous,input.id,input.state,input.note,time),'요구별 처리 상태 변경',false);
        }else{
          if(staff)throw new AppError('시민의 요구 확인과 보완은 민원인 화면에서 할 수 있습니다.',403);
          if(input.action==='confirm'){
            const next=confirmRequests(previous,input.items,time);
            const changed=!previous.confirmedAt||JSON.stringify(previous.items.map(r=>[r.id,r.text,r.withdrawn]))!==JSON.stringify(next.items.map(r=>[r.id,r.text,r.withdrawn]));
            await saveTracking(c,complaintOwner,next,'민원인 요구사항 확인·수정',changed);
            if(changed)await startAnalysis(c.id).catch(()=>undefined);
          }else{
            const item=previous.items.find(r=>r.id===input.id);
            const next=replyToRequest(previous,input.id,input.text,time);
            await saveTracking(c,complaintOwner,next,'민원인 요구별 추가 정보 접수',true,{id:crypto.randomUUID(),role:'citizen',text:`[요구사항: ${item!.text}]\n담당자 확인 요청: ${item!.note}\n추가 정보: ${input.text}`,createdAt:time,attachments:[]});
            await startAnalysis(c.id).catch(()=>undefined);
          }
        }
        return json({ok:true});
      }
      if (!staff) throw new AppError("담당자 권한이 필요합니다.", 403);
      if(c.deleted_at&&method!=='PATCH')throw new AppError('휴지통에서 복구한 후 사용할 수 있습니다.',409);
      if(path[2]==='verify-draft'&&method==='POST') {
        if(c.status==='resolved'||c.auto_state==='processing'||c.auto_state==='queued')throw new AppError('진행 중인 분석이 끝난 후 초안을 검증해 주세요.',409);
        const input=z.object({draft:z.string().trim().min(10).max(10000),revision:z.number().int()}).parse(await body(request));
        if(input.revision!==c.revision)throw new AppError('내용이 변경되었습니다. 새로고침 후 다시 검증해 주세요.',409);
        await rateLimit(owner,'verify',20);
        const keys=await credentials(office);
        const [review,audit]=await Promise.all([verifyDraft(keys.provider==='openai'?keys.openai:keys.gemini,keys.model,keys.provider,input.draft,c.evidence?.citations||c.analysis?.citations||[]),auditRequirements(keys,c)]);
        const coverage=await checkAnswerCoverage(keys,c,audit,input.draft);
        const result=await database().prepare("UPDATE complaints SET draft_review=?,coverage_review=?,revision=revision+1 WHERE id=? AND owner=? AND revision=? AND status!='resolved' AND deleted_at IS NULL AND auto_state NOT IN ('processing','queued')").bind(JSON.stringify(review),JSON.stringify(coverage),c.id,complaintOwner,c.revision).run();
        if(!result.meta.changes)throw new AppError('검증 중 초안이 변경되었습니다. 다시 검증해 주세요.',409);
        await eventStatement(complaintOwner,c.id,'요구사항 누락 및 답변 문장별 근거 검증').run();
        return json({review,coverage});
      }
      if(path[2]==='coverage-decision'&&method==='POST') {
        if(c.status==='resolved'||['queued','processing'].includes(c.auto_state||''))throw new AppError('분석 완료 후 검토할 수 있습니다.',409);
        const input=z.object({revision:z.number().int(),draft:z.string().trim().max(10000),requestId:z.string().max(60),decision:z.enum(['include','exclude','answered','refused','clarification','missing']),reason:z.string().trim().min(5).max(1000)}).parse(await body(request));
        if(c.revision!==input.revision||!coverageIsCurrent(c.coverage_review,c,input.draft))throw new AppError('현재 내용으로 다시 검사한 후 판정을 수정해 주세요.',409);
        const coverage=c.coverage_review!,item=coverage.requirements.find(r=>r.id===input.requestId);
        if(!item)throw new AppError('요구사항을 찾을 수 없습니다.',404);
        if(input.decision==='include') {
          if(!c.analysis)throw new AppError('분석 결과가 없습니다.',409);
          if(!c.analysis.requests.includes(item.text))c.analysis.requests.push(item.text);
          item.summaryStatus='preserved';item.summaryReason='담당자가 원문 요구를 요구사항 목록에 반영했습니다.';
          coverage.analysisSnapshot=analysisSnapshot(c);
        } else item.override={responseStatus:input.decision==='exclude'?item.responseStatus:input.decision,excluded:input.decision==='exclude',reason:maskText(input.reason,c.analysis?.sensitiveQuotes),at:now()};
        const result=await database().prepare("UPDATE complaints SET analysis=?,coverage_review=?,updated_at=?,revision=revision+1 WHERE id=? AND owner=? AND revision=? AND deleted_at IS NULL AND status!='resolved'").bind(JSON.stringify(c.analysis),JSON.stringify(coverage),now(),c.id,complaintOwner,c.revision).run();
        if(!result.meta.changes)throw new AppError('다른 창에서 내용이 변경되었습니다.',409);
        await eventStatement(complaintOwner,c.id,input.decision==='include'?'누락된 요구사항을 목록에 반영':'요구사항 대응 판정 담당자 수정').run();
        return json({ok:true});
      }
      if(path[2]==='reports'&&method==='POST') {
        const input=z.object({revision:z.number().int(),note:z.string().trim().max(2000),confirmed:z.array(z.string().regex(/^F\d+$/)).max(40)}).parse(await body(request));
        if(c.revision!==input.revision)throw new AppError('민원이 변경되었습니다. 새로고침해 주세요.',409);
        const ids=new Set(expressionFindings(c).map((_,i)=>'F'+(i+1)));
        if(input.confirmed.some(id=>!ids.has(id)))throw new AppError('확인할 표현 항목이 변경되었습니다.',409);
        await rateLimit(owner,'report',10);
        const events=(await database().prepare('SELECT * FROM events WHERE complaint_id=? AND owner=? ORDER BY created_at').bind(c.id,complaintOwner).all()).results;
        const report=await createRecordReport(await credentials(office),c,events as unknown as import('../../../lib/types').Event[],input.confirmed,input.note);
        const inserted=await database().prepare(`WITH created AS (INSERT INTO complaint_reports(id,complaint_id,owner,source_digest,masked_data,created_at) SELECT ?,id,owner,?,?,? FROM complaints WHERE id=? AND owner=? AND revision=? AND deleted_at IS NULL RETURNING id), log AS (INSERT INTO events(id,complaint_id,owner,label,created_at) SELECT ?,?,?,?,? FROM created) SELECT id FROM created`).bind(report.id,report.sourceDigest,JSON.stringify(report),report.createdAt,c.id,complaintOwner,c.revision,crypto.randomUUID(),c.id,complaintOwner,'개인정보 가림 대응 기록 생성',now()).first();
        if(!inserted)throw new AppError('보고서 생성 중 민원이 변경되었습니다. 다시 생성해 주세요.',409);
        return json({report},201);
      }
      if(path[2]==='reports'&&path[3]&&method==='GET') {
        const saved=await database().prepare('SELECT masked_data FROM complaint_reports WHERE id=? AND complaint_id=? AND owner=?').bind(path[3],c.id,complaintOwner).first<{masked_data:string}>();
        if(!saved)throw new AppError('기록을 찾을 수 없습니다.',404);
        return new Response(renderReport(JSON.parse(saved.masked_data) as RecordReport),{headers:{'Content-Type':'text/html; charset=utf-8','Content-Disposition':`attachment; filename="complaint-record-${c.id}.html"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; sandbox"}});
      }
      if(path[2]==='reports'&&path.length===3&&method==='GET') {
        const reports=await database().prepare('SELECT id,created_at FROM complaint_reports WHERE complaint_id=? AND owner=? ORDER BY created_at DESC LIMIT 20').bind(c.id,complaintOwner).all();
        return json({reports:reports.results});
      }
      if (path[2] === "evidence" && method === "POST") {
        if (c.auto_state === "processing" || c.auto_state === "queued")
          throw new AppError(
            "자동 분석이 진행 중입니다. 완료 후 다시 시도해 주세요.",
            409,
          );
        await rateLimit(owner, "evidence", 30);
        if (c.status === "resolved")
          throw new AppError("완료된 민원은 변경할 수 없습니다.", 409);
        const keys = await credentials(office);
        if (!keys.law)
          throw new AppError(
            "연결 설정에서 법제처 OPEN API 인증값(OC)을 저장해 주세요.",
            409,
          );
        const context=supplementedComplaint(c);
        const plan=await semanticPlan(keys,context);
        const notes = await autoSync(office, keys.law, c.category, context,plan);
        const docs = await database()
          .prepare("SELECT * FROM documents WHERE owner=?")
          .bind(office)
          .all<StoredDoc>();
        const result = retrieve(docs.results, context,plan,24);
        result.citations=await rerank(keys,context,result.citations);
        const evidence = {
          ...result,
          warnings: [...notes.filter(n=>!result.citations.length||!n.includes('공식 검색 결과를 확인하지 못했습니다.')), ...result.warnings],
          generatedAt: now(),
        };
        const update = await database()
          .prepare(
            "UPDATE complaints SET evidence=?,draft_review=NULL,coverage_review=NULL,updated_at=?,revision=revision+1 WHERE id=? AND owner=? AND revision=?",
          )
          .bind(
            JSON.stringify(evidence),
            now(),
            c.id,
            complaintOwner,
            c.revision,
          )
          .run();
        if (!update.meta.changes)
          throw new AppError(
            "민원이 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
            409,
          );
        await eventStatement(
          complaintOwner,
          c.id,
          "공식 법령·조례 근거 수집 및 검색 완료",
        ).run();
        return json({ ok: true });
      }
      if (path[2] === "analyze" && method === "POST") {
        if (c.status === "resolved")
          throw new AppError("완료된 민원은 다시 분석할 수 없습니다.", 409);
        await rateLimit(owner, "ai", 20);
        await queueAnalysis(c.id);
        await startAnalysis(c.id);
        return json({ ok: true, processing: "queued" }, 202);
      }
      if (path.length === 2 && method === "PATCH") {
        const input = z
          .object({
            revision: z.number().int(),
            action: z.enum(["save", "approve", "status", "tasks", "delete", "restore"]),
            draft: z.string().max(10000).optional(),
            status: z.enum(["received", "reviewing", "waiting"]).optional(),
            reviewed: z.boolean().optional(),
            tasks: z
              .array(
                z.object({
                  id: z.string().max(80),
                  label: z.string().min(1).max(3000),
                  done: z.boolean(),
                }),
              )
              .max(30)
              .optional(),
          })
          .parse(await body(request));
        if (input.revision !== c.revision)
          throw new AppError(
            "내용이 변경되었습니다. 새로고침 후 다시 시도해 주세요.",
            409,
          );
        if(input.action==='restore') {
          const result=await database().prepare("UPDATE complaints SET deleted_at=NULL,updated_at=?,revision=revision+1,auto_state=CASE WHEN analysis IS NULL THEN 'idle' ELSE 'completed' END,auto_message='',workflow_run=NULL,analysis_checkpoint=NULL WHERE id=? AND owner=? AND revision=? AND deleted_at IS NOT NULL").bind(now(),c.id,complaintOwner,c.revision).run();
          if(!result.meta.changes)throw new AppError('복구할 민원을 찾을 수 없거나 변경되었습니다.',409);
          await eventStatement(complaintOwner,c.id,'담당자 민원 복구').run();
          return json({ok:true});
        }
        if(c.deleted_at)throw new AppError('휴지통에서 복구한 후 사용할 수 있습니다.',409);
        if(input.action==='delete') {
          const result=await database().prepare("UPDATE complaints SET deleted_at=?,updated_at=?,revision=revision+1,auto_state='idle',auto_token=NULL,analysis_generation=analysis_generation+1 WHERE id=? AND owner=? AND revision=? AND deleted_at IS NULL").bind(now(),now(),c.id,complaintOwner,c.revision).run();
          if(!result.meta.changes)throw new AppError('내용이 변경되었습니다. 새로고침 후 다시 삭제해 주세요.',409);
          await eventStatement(complaintOwner,c.id,'담당자 민원 삭제').run();
          return json({ok:true});
        }
        let status = c.status,
          draft = c.draft,
          published = c.published,
          tasks = c.tasks,
          label = "변경사항 저장";
        if (input.action === "save") {
          if (c.status === "resolved")
            throw new AppError("완료된 답변은 변경할 수 없습니다.", 409);
          draft = input.draft ?? draft;
          label = "담당자 답변 초안 저장";
        }
        if (input.action === "status") {
          if (c.status === "resolved")
            throw new AppError("완료된 민원입니다.", 409);
          if(input.status==='waiting')throw new AppError('보완 요청란에 확인할 내용을 작성해 주세요.');
          status = input.status || status;
          label = "처리 상태 변경: " + statuses[status];
        }
        if (input.action === "tasks") {
          tasks = input.tasks || tasks;
          label = "후속 조치 체크리스트 변경";
        }
        if (input.action === "approve") {
          if(c.auto_state==='processing'||c.auto_state==='queued')throw new AppError('진행 중인 분석이 끝난 후 답변을 검토해 주세요.',409);
          if (c.status === "resolved")
            throw new AppError("이미 답변이 등록되었습니다.", 409);
          if (!input.reviewed || !input.draft || input.draft.trim().length < 10)
            throw new AppError(
              "답변을 작성하고 근거·사실 검토에 체크해 주세요.",
            );
          draft = input.draft.trim();
          if(!reviewAllowsPublication(c.draft_review,draft))throw new AppError('현재 답변의 문장별 근거를 검증하고 확인이 필요한 문장을 수정해 주세요.',409);
          if(!coverageAllowsPublication(c.coverage_review,c,draft))throw new AppError('요약과 답변에 누락된 요구사항을 확인해 주세요. 현재 답변으로 요구사항 검사를 완료해야 합니다.',409);
          published = draft;
          status = "resolved";
          label = "담당자 검토·승인 후 홈페이지 답변 등록";
        }
        const result = await database()
          .prepare(
            "UPDATE complaints SET status=?,draft=?,published=?,published_citations=?,tasks=?,updated_at=?,revision=revision+1 WHERE id=? AND owner=? AND revision=?",
          )
          .bind(
            status,
            draft,
            published,
            JSON.stringify(input.action==='approve'?(c.evidence?.citations||c.analysis?.citations||[]).filter(x=>inlineReferences(draft,c.evidence?.citations||c.analysis?.citations||[]).ids.includes(x.id)):c.published_citations||[]),
            JSON.stringify(tasks),
            now(),
            c.id,
            complaintOwner,
            c.revision,
          )
          .run();
        if (!result.meta.changes)
          throw new AppError(
            "다른 창의 변경사항이 있습니다. 새로고침해 주세요.",
            409,
          );
        await eventStatement(complaintOwner, c.id, label).run();
        return json({ ok: true });
      }
    }
    if (route === "laws/search" && method === "POST") {
      if (!staff) throw new AppError("담당자 권한이 필요합니다.", 403);
      await rateLimit(owner, "law", 50);
      const input = z
        .object({
          query: z.string().trim().min(2).max(100),
          kind: z.enum(["law", "ordin"]),
        })
        .parse(await body(request));
      const keys = await credentials(office);
      return json({
        results: await searchOfficial(keys.law, input.query, input.kind),
      });
    }
    if (route === "laws/import" && method === "POST") {
      if (!staff) throw new AppError("담당자 권한이 필요합니다.", 403);
      await rateLimit(owner, "law", 50);
      const input = z
        .object({
          id: z.string().regex(/^\d{1,15}$/),
          kind: z.enum(["law", "ordin"]),
        })
        .parse(await body(request));
      const keys = await credentials(office);
      return json(await importDocument(office, keys.law, input.id, input.kind));
    }
    throw new AppError("요청한 기능을 찾을 수 없습니다.", 404);
  } catch (error) {
    if (error instanceof z.ZodError)
      return json({ error: "입력 항목의 길이와 형식을 확인해 주세요." }, 400);
    if(error instanceof TrackingError)return json({error:error.message},400);
    if (error instanceof AppError)
      return json({ error: error.message }, error.status);
    // Never log request bodies, credentials, or external error bodies.
    return json(
      { error: "요청을 처리하지 못했습니다. 잠시 후 새로고침해 주세요." },
      500,
    );
  }
}
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
