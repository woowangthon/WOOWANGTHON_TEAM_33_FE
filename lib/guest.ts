import { createHash, randomBytes } from "node:crypto";
import { database } from "./database";

export const guestCookie = "shield_workspace";
export const guestMaxAge = 90 * 24 * 60 * 60;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const validToken = (value: string) => /^[a-f0-9]{64}$/.test(value);
export function isGuestOwner(owner: string) {
  return /^guest:[a-f0-9-]{36}$/.test(owner);
}

export async function guestIdentity(token: string | undefined) {
  if (!token || !validToken(token)) return null;
  const row = await database()
    .prepare(
      "SELECT owner FROM guest_sessions WHERE token_hash=? AND expires_at>NOW()",
    )
    .bind(hash(token))
    .first<{ owner: string }>();
  if (!row || !isGuestOwner(row.owner)) return null;
  return {
    userId: row.owner,
    email: "",
    fullName: "작업공간",
    emailVerified: false,
    isStaff: true,
    isGuest: true,
  };
}
export async function createGuestSession(
  owner = "guest:" + crypto.randomUUID(),
) {
  if (!isGuestOwner(owner)) throw new Error("Invalid workspace");
  const token = randomBytes(32).toString("hex");
  await database()
    .prepare(
      "INSERT INTO guest_sessions (token_hash,owner,expires_at) VALUES (?,?,?)",
    )
    .bind(
      hash(token),
      owner,
      new Date(Date.now() + guestMaxAge * 1000).toISOString(),
    )
    .run();
  return token;
}
export async function createTransfer(
  owner: string,
  source: string,
  target: string,
) {
  if (!isGuestOwner(owner)) throw new Error("Invalid workspace");
  const token = randomBytes(32).toString("hex");
  await database()
    .prepare(
      "INSERT INTO guest_transfers (token_hash,owner,source_origin,target_origin,expires_at) VALUES (?,?,?,?,?)",
    )
    .bind(
      hash(token),
      owner,
      source,
      target,
      new Date(Date.now() + 60000).toISOString(),
    )
    .run();
  return token;
}
export async function consumeTransfer(
  token: string,
  source: string,
  target: string,
) {
  if (!validToken(token)) return null;
  // A code is accepted once, only by the paired site, and is never put in a URL.
  const row = await database()
    .prepare(
      "DELETE FROM guest_transfers WHERE token_hash=? AND source_origin=? AND target_origin=? AND expires_at>NOW() RETURNING owner",
    )
    .bind(hash(token), source, target)
    .first<{ owner: string }>();
  return row?.owner && isGuestOwner(row.owner) ? row.owner : null;
}
