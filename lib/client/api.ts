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

export interface ApiCallInit {
  readonly method?: string;
  /** Sent as JSON. */
  readonly body?: unknown;
  /** Sent as-is instead of `body` (e.g. a compressed file upload). */
  readonly upload?: { readonly bytes: Blob; readonly contentType: string };
  readonly timeoutMs?: number;
}

function requestBody(init: ApiCallInit): { headers?: Record<string, string>; body?: BodyInit } {
  if (init.upload !== undefined) return { headers: { "content-type": init.upload.contentType }, body: init.upload.bytes };
  if (init.body !== undefined) return { headers: { "content-type": "application/json" }, body: JSON.stringify(init.body) };
  return {};
}

export async function apiCall<T>(path: string, init: ApiCallInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: init.method ?? "GET",
      ...requestBody(init),
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
