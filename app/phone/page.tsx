import PhoneDesk from '../phone-desk';
export const dynamic='force-dynamic';
export default async function PhonePage({searchParams}:{searchParams:Promise<{demo?:string}>}){
  const demo=(await searchParams).demo==='1';
  return <main className="phone-standalone"><PhoneDesk staff={process.env.SITE_MODE==='staff'} demo={demo}/><nav className="phone-home-bottom" aria-label="페이지 이동"><a href="/">홈으로</a></nav></main>;
}
