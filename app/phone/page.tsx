import PhoneDesk from '../phone-desk';
export const dynamic='force-dynamic';
export default async function PhonePage({searchParams}:{searchParams:Promise<{demo?:string}>}){
  const demo=(await searchParams).demo==='1';
  return <main className="phone-standalone"><a className="phone-home" href="/">민원쉴드 <span>홈으로</span></a><PhoneDesk staff={process.env.SITE_MODE==='staff'} demo={demo}/></main>;
}
