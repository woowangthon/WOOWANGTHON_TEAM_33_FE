import {createHmac,timingSafeEqual} from 'node:crypto';

export function registeredPhoneEndpoint(body:string,signature:string|null,secret:string|undefined,now=Date.now(),allowedHosts='') {
  if(!secret||body.length>2000||!signature||!/^\w{64}$/.test(signature))return null;
  const expected=createHmac('sha256',secret).update(body).digest('hex');
  if(!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return null;
  try {
    const input=JSON.parse(body),url=new URL(input.endpoint);
    if(!Number.isFinite(input.issuedAt)||Math.abs(now-input.issuedAt)>120000)return null;
    const hostAllowed=/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname)||allowedHosts.split(',').map(s=>s.trim()).filter(Boolean).includes(url.hostname);
    if(!hostAllowed||url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash||url.pathname!=='/')return null;
    return url.origin;
  }catch{return null;}
}
