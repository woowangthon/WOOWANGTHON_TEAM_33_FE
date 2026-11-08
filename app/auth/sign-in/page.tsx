import LoginForm from './form';
import {getCurrentUser} from '../../user';
export const dynamic='force-dynamic';
export default async function SignIn(){const user=await getCurrentUser();return <LoginForm email={user?.email} verified={!!user?.emailVerified} staffSite={process.env.SITE_MODE==='staff'}/>;}
