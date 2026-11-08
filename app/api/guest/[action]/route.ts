import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { randomBytes, createHash } from "node:crypto";
import {
  createGuestSession,
  createTransfer,
  consumeTransfer,
  guestCookie,
  guestIdentity,
  guestMaxAge,
} from "../../../../lib/guest";
import { AppError, rateLimit } from "../../../../lib/server";

export const dynamic = "force-dynamic";
function sites() {
  const citizen = new URL(
    process.env.CITIZEN_SITE_URL || "https://shield-and-solve.vercel.app",
  ).origin;
  const staff = new URL(
    process.env.STAFF_SITE_URL || "https://shield-solve-staff.vercel.app",
  ).origin;
  return process.env.SITE_MODE === "staff"
    ? { own: staff, other: citizen }
    : { own: citizen, other: staff };
}
function redirect(path: string) {
  return NextResponse.redirect(new URL(path, sites().own), 303);
}
function install(response: NextResponse, token: string) {
  response.cookies.set(guestCookie, token, {
    httpOnly: true,
    secure: sites().own.startsWith("https:"),
    sameSite: "lax",
    path: "/",
    maxAge: guestMaxAge,
  });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "strict-origin");
  return response;
}
async function transferPage(owner: string) {
  const { own, other } = sites();
  const code = await createTransfer(owner, own, other);
  const nonce = randomBytes(16).toString("base64");
  // no-referrer makes Origin null on browser form POSTs. Send only the origin
  // so the receiving site can retain its strict cross-site request check.
  const html = `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="referrer" content="strict-origin"><title>민원쉴드</title><form id="transfer" method="post" action="${other}/api/guest/receive"><input type="hidden" name="code" value="${code}"><noscript><button type="submit">사이트로 이동</button></noscript></form><script nonce="${nonce}">document.getElementById('transfer').submit()</script></html>`;
  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "strict-origin",
      "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; form-action ${other}; frame-ancestors 'none'; base-uri 'none'`,
    },
  });
}
async function handle(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  try {
    const { action } = await params;
    const { own, other } = sites();
    const session = await guestIdentity(
      (await cookies()).get(guestCookie)?.value,
    );
    if (request.method === "GET" && action === "start") {
      if (session) return redirect("/");
      // Visit the paired site once so direct visits to either URL reuse the
      // same browser workspace, without third-party cookies or an account.
      return NextResponse.redirect(new URL("/api/guest/bootstrap", other), 303);
    }
    if (request.method === "GET" && action === "bootstrap") {
      if (session) return transferPage(session.userId);
      const ip =
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
        "unknown";
      await rateLimit(
        "guest-start:" + createHash("sha256").update(ip).digest("hex"),
        "create",
        30,
      );
      const owner = "guest:" + crypto.randomUUID();
      const token = await createGuestSession(owner);
      return install(await transferPage(owner), token);
    }
    if (request.method === "GET" && action === "switch") {
      if (!session) return redirect("/api/guest/start");
      // Block embedding/cross-site triggering of a workspace handoff.
      if (request.headers.get("sec-fetch-site") === "cross-site")
        throw new AppError("허용되지 않은 요청입니다.", 403);
      await rateLimit(session.userId, "switch", 60);
      return transferPage(session.userId);
    }
    if (request.method === "POST" && action === "receive") {
      if (request.headers.get("origin") !== other)
        throw new AppError("허용되지 않은 요청입니다.", 403);
      const raw = await request.text();
      if (raw.length > 300) throw new AppError("잘못된 요청입니다.");
      const owner = await consumeTransfer(
        new URLSearchParams(raw).get("code") || "",
        other,
        own,
      );
      if (!owner)
        throw new AppError(
          "이동 링크가 만료되었습니다. 이전 화면에서 다시 이동해 주세요.",
          400,
        );
      return install(redirect("/"), await createGuestSession(owner));
    }
    return new Response("Not found", { status: 404 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof AppError
            ? error.message
            : "작업공간을 열지 못했습니다. 새로고침해 주세요.",
      },
      {
        status: error instanceof AppError ? error.status : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
export const GET = handle;
export const POST = handle;
