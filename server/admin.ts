import { jwtVerify, SignJWT } from "jose";
import type { Request } from "express";
import { ENV } from "./_core/env";
import { getSessionCookieOptions } from "./_core/cookies";

export const ADMIN_COOKIE = "pie-admin-session";
const ADMIN_SCOPE = "pie-admin";
const signingSecret = new TextEncoder().encode(ENV.cookieSecret || "pie-development-secret");

export function validateAdminCode(code: string) {
  return Boolean(process.env.ADMIN_CODE) && code === process.env.ADMIN_CODE;
}

function readCookie(req: Request, name: string) {
  const raw = req.headers.cookie ?? "";
  const match = raw.split(";").map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}

export async function createAdminSession(userId: number) {
  return new SignJWT({ scope: ADMIN_SCOPE })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(signingSecret);
}

export async function hasAdminSession(req: Request, userId: number) {
  const token = readCookie(req, ADMIN_COOKIE);
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, signingSecret);
    return payload.scope === ADMIN_SCOPE && payload.sub === String(userId);
  } catch {
    return false;
  }
}

export function setAdminCookie(res: { cookie: (name: string, value: string, options: Record<string, unknown>) => void }, req: Request, token: string) {
  res.cookie(ADMIN_COOKIE, token, { ...getSessionCookieOptions(req), maxAge: 60 * 60 * 1000 });
}

export function clearAdminCookie(res: { clearCookie: (name: string, options: Record<string, unknown>) => void }, req: Request) {
  res.clearCookie(ADMIN_COOKIE, { ...getSessionCookieOptions(req), maxAge: -1 });
}
