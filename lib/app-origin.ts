import { z } from "zod";

/**
 * The origin used to build links that leave the app (e.g. the magic-link return URL). Never
 * derived from request headers, which a client controls. Resolution order: explicit APP_ORIGIN,
 * then Vercel's system variables, then the local dev server.
 */
const originSchema = z.url().refine((value) => new URL(value).origin === value.replace(/\/$/, ""), "must be a bare origin");

export const LOCAL_DEV_ORIGIN = "http://127.0.0.1:3000";

export function resolveAppOrigin(env: Readonly<Record<string, string | undefined>> = process.env): string {
  if (env.APP_ORIGIN) return new URL(originSchema.parse(env.APP_ORIGIN)).origin;
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  if (env.NODE_ENV === "production") throw new Error("APP_ORIGIN must be set outside Vercel in production");
  return LOCAL_DEV_ORIGIN;
}
