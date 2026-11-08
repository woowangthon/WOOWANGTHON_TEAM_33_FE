export const OFFICE='office:cheongju';
export const PUBLIC_OFFICE='office:cheongju:public';
export const publicStaffInbox=()=>process.env.PUBLIC_STAFF_INBOX==='true';
export function officeForOwner(owner:string) {
  return owner.startsWith('guest:') ? (publicStaffInbox()?PUBLIC_OFFICE:owner) : OFFICE;
}
export function officeScope(office:string) {
  return office===PUBLIC_OFFICE ? "owner LIKE 'guest:%'" : office.startsWith('guest:') ? 'owner=?' : "owner NOT LIKE 'guest:%'";
}
export function isStaffIdentity(user:{email:string;emailVerified:boolean}, allowed=process.env.STAFF_EMAILS||'') {
  return user.emailVerified && allowed.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).includes(user.email.toLowerCase());
}
export function publicComplaint<T extends {analysis:unknown;draft:string;tasks:unknown;evidence?:unknown;draft_review?:unknown}>(value:T) {
  return {...value,analysis:null,draft:'',tasks:[],evidence:null,draft_review:null,coverage_review:null,auto_state:undefined,auto_message:undefined};
}
