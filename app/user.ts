import { auth } from '../lib/auth/server';
import { isStaffIdentity } from '../lib/access';
import { cookies } from 'next/headers';
import { guestCookie, guestIdentity } from '../lib/guest';
export async function getCurrentUser() {
  const guest=await guestIdentity((await cookies()).get(guestCookie)?.value);
  if(guest)return guest;
  const {data:session}=await auth.getSession().catch(()=>({data:null}));
  if(!session?.user)return null;
  const user=session.user;
  return {userId:user.id,email:user.email,fullName:user.name,emailVerified:user.emailVerified,isStaff:isStaffIdentity(user),isGuest:false};
}
