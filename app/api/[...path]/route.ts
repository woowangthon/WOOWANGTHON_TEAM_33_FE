import { startAnalysis } from "../../../lib/analysis-dispatch";
import { taskChangeLabels } from "../../../lib/task-history";
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
  retrieve,
  type StoredDoc,
} from "../../../lib/laws";
import { categories, statuses } from "../../../lib/types";
import { samples } from "../../../lib/samples";
import { after } from "next/server";
import {createRecordReport} from '../../../lib/reports';
import {renderReport,type RecordReport} from '../../../lib/report-core';
import {expressionFindings,maskText} from '../../../lib/protection';
import {
  queueAnalysis,
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
      // The staff library is retired; retain the citizen site's read-only law guide.
      const docs = !staff && user.isGuest && url.searchParams.get("poll") !== "1"
        ? await database().prepare("SELECT id,source_id,title,kind,jurisdiction,effective_date,source_url,imported_at,json_array_length(articles::json) AS article_count FROM documents WHERE owner=? ORDER BY imported_at DESC").bind(office).all<Omit<StoredDoc, "owner" | "articles"> & { article_count: number }>()
        : null;
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
        ...(docs ? {documents:docs.results.map(({article_count,...d})=>({...d,articleCount:Number(article_count)}))} : {}),
        user: { name: user.fullName || user.email },
      });
    }
    if (route === "complaints" && method === "POST") {
      const input = createSchema.parse(await body(request));
      if(staff&&input.channel!=="phone")return json({error:"담당자 직접 등록은 더 이상 제공하지 않습니다."},410);
      await rateLimit(owner, "create", 60);
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
      // Read-only diagnostics share the complaint's existing staff/office scope.
      // Credentials and unrelated checkpoint fields are never projected.
      if(path.length===3&&path[2]==='harness'&&method==='GET') {
        if(!staff)throw new AppError('담당자 권한이 필요합니다.',403);
        const checkpoint=JSON.parse(String(row.analysis_checkpoint||'{}'));
        return json({id:c.id,state:c.auto_state,audit:c.analysis?.summaryHarness||null,pending:{
          facts:checkpoint.plan?.facts||null,candidate:checkpoint.analysis?.summary||null,requests:checkpoint.analysis?.requests||null,
          review:checkpoint.summaryFailure||null,progress:checkpoint.summaryProgress||null,recovery:checkpoint.summaryRecovery||null,
          stages:{plan:!!checkpoint.plan,evidence:!!checkpoint.evidence,analysis:!!checkpoint.analysis,summary:!!checkpoint.summary},
        }});
      }
      if (path.length === 2 && method === "GET") {
        if (staff && !c.deleted_at && c.status !== 'resolved' &&
          (c.auto_state === 'queued' || (c.auto_state === 'idle' && !c.analysis))) {
          after(() => startAnalysis(c.id).catch(() => undefined));
        }
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
      if(['requirements','verify-draft','coverage-decision','supplements'].includes(path[2])&&method==='POST') {
        return json({error:'더 이상 제공하지 않는 기능입니다.'},410);
      }
      if (!staff) throw new AppError("담당자 권한이 필요합니다.", 403);
      if(c.deleted_at&&method!=='PATCH')throw new AppError('휴지통에서 복구한 후 사용할 수 있습니다.',409);
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
            status: z.enum(["received", "reviewing"]).optional(),
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
          const result=await database().prepare("UPDATE complaints SET deleted_at=NULL,updated_at=?,revision=revision+1,auto_state=CASE WHEN analysis IS NULL AND status!='resolved' THEN 'queued' ELSE 'completed' END,auto_message='',workflow_run=NULL,analysis_checkpoint=NULL WHERE id=? AND owner=? AND revision=? AND deleted_at IS NOT NULL").bind(now(),c.id,complaintOwner,c.revision).run();
          if(!result.meta.changes)throw new AppError('복구할 민원을 찾을 수 없거나 변경되었습니다.',409);
          await eventStatement(complaintOwner,c.id,'담당자 민원 복구').run();
          if (!c.analysis && c.status !== 'resolved') after(() => startAnalysis(c.id).catch(() => undefined));
          return json({ok:true});
        }
        if(c.deleted_at)throw new AppError('휴지통에서 복구한 후 사용할 수 있습니다.',409);
        if(input.action==='delete') {
          const result=await database().prepare("UPDATE complaints SET deleted_at=?,updated_at=?,revision=revision+1,auto_state='idle',auto_token=NULL,analysis_generation=analysis_generation+1 WHERE id=? AND owner=? AND revision=? AND deleted_at IS NULL").bind(now(),now(),c.id,complaintOwner,c.revision).run();
          if(!result.meta.changes)throw new AppError('내용이 변경되었습니다. 새로고침 후 다시 삭제해 주세요.',409);
          await eventStatement(complaintOwner,c.id,'담당자 민원 삭제').run();
          return json({ok:true});
        }
        if(input.action==='tasks') {
          const submitted=input.tasks;
          if(!submitted||submitted.length!==c.tasks.length||new Set(submitted.map(t=>t.id)).size!==c.tasks.length||submitted.some(t=>!c.tasks.some(old=>old.id===t.id)))
            throw new AppError('후속 조치 항목이 변경되었습니다. 새로고침해 주세요.',409);
          const tasks=c.tasks.map(task=>({...task,done:submitted.find(t=>t.id===task.id)!.done}));
          const labels=taskChangeLabels(c.tasks,tasks);
          if(!labels.length)return json({revision:c.revision,tasks});
          const updatedAt=now(),event={id:crypto.randomUUID(),label:labels.join('\n'),created_at:updatedAt};
          // Commit the checklist and its precise history together in one round trip.
          const saved=await database().prepare(`WITH changed AS (
            UPDATE complaints SET tasks=?,updated_at=?,revision=revision+1
            WHERE id=? AND owner=? AND revision=? AND deleted_at IS NULL RETURNING id,owner,revision
          ), logged AS (
            INSERT INTO events(id,complaint_id,owner,label,created_at) SELECT ?,id,owner,?,? FROM changed
          ) SELECT revision FROM changed`).bind(JSON.stringify(tasks),updatedAt,c.id,complaintOwner,c.revision,event.id,event.label,updatedAt).first<{revision:number}>();
          if(!saved)throw new AppError('다른 창에서 후속 조치가 변경되었습니다.',409);
          return json({revision:saved.revision,tasks,event,updatedAt});
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
          status = input.status || status;
          label = "처리 상태 변경: " + statuses[status];
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
    if (["laws/search", "laws/import"].includes(route) && method === "POST") {
      if (!staff) throw new AppError("담당자 권한이 필요합니다.", 403);
      return json({error:"더 이상 제공하지 않는 기능입니다."},410);
    }
    throw new AppError("요청한 기능을 찾을 수 없습니다.", 404);
  } catch (error) {
    if (error instanceof z.ZodError)
      return json({ error: "입력 항목의 길이와 형식을 확인해 주세요." }, 400);
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
