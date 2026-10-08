import "server-only";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getSessionUser, type SessionUser } from "@/lib/auth/dal";
import { LedgerError } from "@/lib/execution/supabase-usage-ledger";
import { createLogger, type Logger } from "@/lib/observability/log";
import { StoreError } from "./learning-store";

/**
 * API envelope for /api/v1 (spec §67): every response carries a request id; errors are
 * `{ error: { code, message, requestId, details? } }` with a meaningful status; every call is
 * logged at entry and exit with latency, and unexpected failures are metricked by type.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ApiContext {
  readonly requestId: string;
  readonly log: Logger;
  readonly user: SessionUser;
}

const baseLogger = createLogger({ component: "api" });

function errorResponse(error: ApiError, requestId: string): NextResponse {
  return NextResponse.json(
    { error: { code: error.code, message: error.message, requestId, ...(error.details === undefined ? {} : { details: error.details }) } },
    { status: error.status, headers: { "x-request-id": requestId, ...(error.headers ?? {}) } },
  );
}

/**
 * Authenticated endpoint. `operation` names the call in logs and metrics. The handler's return
 * value is sent as JSON, unless it is a Response (a download), which is sent as-is.
 */
export async function handleApi(operation: string, handler: (context: ApiContext) => Promise<unknown>): Promise<Response> {
  const requestId = randomUUID();
  const started = performance.now();
  const log = baseLogger.child({ requestId, operation });
  let status = 200;
  try {
    const user = await getSessionUser();
    if (user === undefined) throw new ApiError(401, "unauthenticated", "Sign in to continue.");
    log.log("info", "api.request", { userId: user.userId });
    const body = await handler({ requestId, log: log.child({ userId: user.userId }), user });
    if (body instanceof Response) {
      // Downloads and other non-JSON bodies: the handler sets its own content headers.
      body.headers.set("x-request-id", requestId);
      body.headers.set("cache-control", "no-store");
      status = body.status;
      return body;
    }
    return NextResponse.json(body, { headers: { "x-request-id": requestId, "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ApiError) {
      status = error.status;
      return errorResponse(error, requestId);
    }
    if (error instanceof StoreError || error instanceof LedgerError) {
      status = 503;
      log.log("error", "api.dependency_unavailable", { errorType: error.name, message: error.message });
      log.metric("api.dependency_unavailable", 1, { errorType: error.name });
      return errorResponse(new ApiError(503, "dependency_unavailable", "A service CodeQuest depends on is unavailable. Your work is saved; please try again shortly."), requestId);
    }
    if (error instanceof ZodError) {
      status = 400;
      return errorResponse(new ApiError(400, "invalid_request", "The request body is invalid.", error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message }))), requestId);
    }
    status = 500;
    log.log("error", "api.unhandled_error", { errorType: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : String(error) });
    log.metric("api.unhandled_error", 1, { errorType: error instanceof Error ? error.name : "unknown" });
    return errorResponse(new ApiError(500, "internal_error", "Something went wrong on our side. Your work is saved; please try again."), requestId);
  } finally {
    const latencyMs = Math.round(performance.now() - started);
    log.log(status >= 500 ? "error" : "info", "api.response", { status, latencyMs });
    log.metric("api.latency_ms", latencyMs, { status });
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "The request body must be JSON.");
  }
}
