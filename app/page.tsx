import Workspace from './workspace';
import StaffWorkspace from './staff-workspace';
import { getCurrentUser } from './user';
import { redirect } from 'next/navigation';
export const dynamic='force-dynamic';
export default async function Home(){
  const user=await getCurrentUser();
  if(!user)redirect('/api/guest/start');
  const staffSite=process.env.SITE_MODE==='staff';
  if(staffSite && !user.isStaff)redirect('/api/guest/start');
  const otherSiteUrl=user.isGuest?'/api/guest/switch':(staffSite?process.env.CITIZEN_SITE_URL:process.env.STAFF_SITE_URL)||'/';
  if(staffSite)return <StaffWorkspace authenticated={true} otherSiteUrl={otherSiteUrl} />;
  return <Workspace authenticated={true} staffSite={false} otherSiteUrl={otherSiteUrl} />;
}
