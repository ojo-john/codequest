"use client";

/** Typed calls to /api/v1 from the browser. Errors carry the server's code, message and request id. */

export class ClientApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ClientApiError";
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function apiCall<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new ClientApiError(0, timedOut ? "timeout" : "network", timedOut ? "The server took too long to answer." : "Can't reach CodeQuest — check your connection. Your code is kept on this device.");
  }
  const body = (await response.json().catch(() => undefined)) as { error?: { code: string; message: string; requestId?: string; details?: unknown } } | undefined;
  if (!response.ok) {
    const error = body?.error;
    throw new ClientApiError(response.status, error?.code ?? "http_error", error?.message ?? `Request failed (${response.status}).`, error?.requestId, error?.details);
  }
  return body as T;
}
