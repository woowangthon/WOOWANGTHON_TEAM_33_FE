import { database } from './database';
import type { Complaint } from './types';
import { protectedTitle } from './protection';
import { readableCitations } from './citations';

export const runtime = process.env;
export { database };
export const now = () => new Date().toISOString();
export class AppError extends Error { constructor(message:string, public status=400) {super(message);} }
export function decodeComplaint(row:Record<string,unknown>):Complaint {
  const { owner: _owner, auto_token: _token, auto_started_at: _started, analysis_checkpoint:_checkpoint, analysis_generation:_generation, workflow_run:_run, ...safe }=row;
  const result={...safe, draft_review:row.draft_review?JSON.parse(String(row.draft_review)):null, evidence:row.evidence?JSON.parse(String(row.evidence)):null, analysis: row.analysis ? JSON.parse(String(row.analysis)):null, tasks:JSON.parse(String(row.tasks || '[]'))} as Complaint;
  result.supplements=JSON.parse(String(row.supplements||'[]'));
  result.published_citations=JSON.parse(String(row.published_citations||'[]'));
  const citations=result.evidence?.citations||result.analysis?.citations||[];
  result.draft=readableCitations(result.draft||'',citations);
  if(result.analysis)result.analysis.draft=readableCitations(result.analysis.draft,citations);
  if(result.published&&!result.published_citations?.length)result.published_citations=result.analysis?.citations||[];
  result.published=readableCitations(result.published||'',result.published_citations||[]);
  return {...result,display_title:protectedTitle(result)};
}
export async function complaint(owner:string,id:string) {
  const row=await database().prepare('SELECT * FROM complaints WHERE id=? AND owner=?').bind(id,owner).first<Record<string,unknown>>();
  if(!row) throw new AppError('민원을 찾을 수 없습니다.',404);
  return decodeComplaint(row);
}
export function eventStatement(owner:string,id:string,label:string) {
  return database().prepare('INSERT INTO events (id,complaint_id,owner,label,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),id,owner,label,now());
}
async function cipherKey() {
  if(!runtime.APP_SECRET) throw new AppError('서버의 암호화 설정이 필요합니다.',503);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(runtime.APP_SECRET));
  return crypto.subtle.importKey('raw',hash,'AES-GCM',false,['encrypt','decrypt']);
}
export async function encrypt(value:unknown,owner:string) {
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(owner)},await cipherKey(),new TextEncoder().encode(JSON.stringify(value)));
  return btoa(String.fromCharCode(...iv))+'.'+btoa(String.fromCharCode(...new Uint8Array(encrypted)));
}
export async function credentials(owner:string) {
  // These credentials are deliberately provisioned for the public service.
  // Legacy account credentials below remain isolated from guest workspaces.
  const service = {
    provider: runtime.SERVICE_AI_PROVIDER === 'openai' ? 'openai' : 'gemini',
    openai: runtime.SERVICE_OPENAI_API_KEY || '',
    gemini: runtime.SERVICE_GEMINI_API_KEY || '',
    law: runtime.SERVICE_LAW_API_OC || '',
    model: runtime.SERVICE_AI_PROVIDER === 'openai' ? runtime.SERVICE_OPENAI_MODEL || 'gpt-6-luna' : runtime.SERVICE_GEMINI_MODEL || 'gemini-2.5-flash-lite',
  };
  if(owner==='office:cheongju:public')return service;
  if ((service.provider==='openai' ? service.openai : service.gemini) && service.law) return service;
  const row=await database().prepare('SELECT encrypted,model FROM settings WHERE owner=?').bind(owner).first<{encrypted:string;model:string}>();
  let keys:{gemini?:string;law?:string}={};
  if(row) {
    try { const [iv,data]=row.encrypted.split('.'); const bytes=(s:string)=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:new TextEncoder().encode(owner)},await cipherKey(),bytes(data));
      keys=JSON.parse(new TextDecoder().decode(plain));
    } catch {throw new AppError('저장된 연결 정보를 읽을 수 없습니다. 서버 암호화 설정을 확인해 주세요.',503);}
  }
  return {...service,gemini:service.gemini || keys.gemini || (!owner.startsWith('guest:') && runtime.GEMINI_API_KEY) || '',law:service.law || keys.law || (!owner.startsWith('guest:') && runtime.LAW_API_OC) || '',model:service.provider==='openai'||service.gemini ? service.model : row?.model || service.model};
}
export async function rateLimit(owner:string,action:string,max:number) {
  const bucket=now().slice(0,13);
  const row=await database().prepare('INSERT INTO limits (id,count) VALUES (?,1) ON CONFLICT(id) DO UPDATE SET count=limits.count+1 RETURNING count').bind(owner+':'+action+':'+bucket).first<{count:number}>();
  if((row?.count || 0)>max) throw new AppError('시간당 요청 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',429);
}
