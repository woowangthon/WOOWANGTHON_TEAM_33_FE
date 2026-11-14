// PSTN integration is deliberately disabled in the web-call prototype.
export async function POST() {
  return Response.json({error:'현재 시제품은 웹 음성 상담만 지원합니다.'},{status:410,headers:{'Cache-Control':'no-store'}});
}
