import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
export function signTicket(secret, claims, ttl = 120) {
  const payload = Buffer.from(JSON.stringify({ ...claims, exp: Math.floor(Date.now()/1000)+ttl, nonce: randomUUID() })).toString('base64url');
  return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');
}
export function verifyTicket(secret, token) {
  if(typeof token!=='string'||token.length>3000)throw new Error('Invalid_ticket');
  const [payload,mac,extra]=token.split('.');
  const expected=createHmac('sha256',secret).update(payload||'').digest();
  const actual=Buffer.from(mac||'','base64url');
  if(extra||actual.length!==expected.length||!timingSafeEqual(actual,expected))throw new Error('Invalid_ticket');
  const claims=JSON.parse(Buffer.from(payload,'base64url').toString());
  if(!claims.nonce||claims.exp<Math.floor(Date.now()/1000)||!['staff','caller','carrier'].includes(claims.role))throw new Error('Expired_ticket');
  return claims;
}
