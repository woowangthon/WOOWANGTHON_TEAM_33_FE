import {expressionFindings,protectedTitle} from './protection';
import type {Analysis,Complaint} from './types';

export type ComplaintListItem=Pick<Complaint,'id'|'title'|'category'|'location'|'status'|'auto_state'|'created_at'|'deleted_at'|'is_sample'> & {
  display_title:string;
  hasAnalysis:boolean;
  hasSensitiveExpression:boolean;
  hasPublicSource:boolean;
};

// Keep large checkpoints, audits, drafts and citations out of the list query.
// The source text is used only on the server to validate attack quotes.
export const complaintListColumns=`id,title,body,category,location,status,auto_state,created_at,deleted_at,is_sample,
  source_data IS NOT NULL AS has_public_source,
  CASE WHEN analysis IS NULL OR analysis::jsonb='null'::jsonb THEN NULL ELSE json_strip_nulls(json_build_object(
    'safeTitle',analysis::json->'safeTitle',
    'sensitiveQuotes',analysis::json->'sensitiveQuotes',
    'requests',analysis::json->'requests',
    'expressionFindings',analysis::json->'expressionFindings'
  ))::text END AS analysis`;

export function complaintListItem(row:Record<string,unknown>):ComplaintListItem {
  const analysis=row.analysis?JSON.parse(String(row.analysis)) as Pick<Analysis,'safeTitle'|'sensitiveQuotes'|'requests'|'expressionFindings'>:null;
  const original={title:String(row.title),body:String(row.body),analysis};
  const title=protectedTitle(original);
  return {
    id:String(row.id),title,display_title:title,category:String(row.category),location:String(row.location||''),
    status:(row.status==='waiting'?'reviewing':row.status) as Complaint['status'],
    auto_state:row.auto_state as Complaint['auto_state'],created_at:String(row.created_at),
    deleted_at:row.deleted_at?String(row.deleted_at):null,is_sample:Number(row.is_sample||0),
    hasAnalysis:!!analysis,hasPublicSource:row.has_public_source===true,
    hasSensitiveExpression:expressionFindings(original).some(f=>f.kind!=='criticism'),
  };
}
