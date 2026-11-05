/**
 * T051 — the endpoint guard (F109-FR-018).
 *
 * A secret is sent only to the host it is bound to. A plain, unencrypted
 * endpoint is refused unless its address is loopback. A redirect is
 * refused. The free read-only request for a model list carries the
 * credential, is a READ request, ends after 3 seconds at the latest, and
 * its value is never stored or logged. A secret reaches a harness by the
 * environment or by standard input and never in an argument list.
 */
import { request as httpRequest } from "node:http";
import { isLoopbackAddress } from "../generic/loopback.ts";

/** The longest a free model-list request may take, in milliseconds. */
export const MAX_MODEL_LIST_MS = 3_000 as const;

/** The addresses that count as loopback. */
export const LOOPBACK_HOSTS = ["127.0.0.1", "::1", "[::1]", "localhost"] as const;

export { isLoopbackAddress };

/** Why the guard refused a call. */
export type GuardRefusalReason =
  | "host-not-bound"
  | "plain-address"
  | "redirect"
  | "secret-in-arguments"
  | "model-list-timeout"
  | "transport-failed";

export type GuardOk = { readonly ok: true };
export type GuardRefusal = {
  readonly ok: false;
  readonly reason: GuardRefusalReason;
  readonly message: string;
};
export type GuardResult = GuardOk | GuardRefusal;

function refusal(reason: GuardRefusalReason, message: string): GuardRefusal {
  return { ok: false, reason, message };
}

function hostOf(address: string): string {
  // The HOST, without the port: a secret is bound to a host, not to a port.
  try {
    return new URL(address).hostname.toLowerCase();
  } catch {
    return address;
  }
}

/**
 * F109-FR-018 — the address of a call: a plain (unencrypted) address is
 * refused unless it is loopback. `https` addresses pass this arm.
 */
export function guardAddress(address: string): GuardResult {
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return refusal("plain-address", `the endpoint address is not a URL: ${address}`);
  }
  if (parsed.protocol === "https:") {
    return { ok: true };
  }
  if (parsed.protocol === "http:" && isLoopbackAddress(parsed.hostname)) {
    return { ok: true };
  }
  return refusal(
    "plain-address",
    "a plain, unencrypted endpoint is refused unless its address is loopback",
  );
}

/**
 * F109-FR-018 — a secret goes to its bound host only. `boundHost` is the
 * host the descriptor binds the credential to; `address` is where this call
 * goes. A call to any other host is refused BEFORE the credential is
 * attached.
 */
export function guardCredentialHost(boundAddress: string, address: string): GuardResult {
  if (hostOf(boundAddress) === hostOf(address)) {
    return { ok: true };
  }
  return refusal(
    "host-not-bound",
    `the secret is bound to the host of ${boundAddress} and is not sent to ${address}`,
  );
}

/**
 * F109-FR-018 — a redirect is refused. Callers fetch with
 * `redirect: "manual"` and hand the answer's status here; the body of a
 * redirect is never read and the credential is not sent a second time.
 */
export function guardRedirect(status: number): GuardResult {
  if (status >= 300 && status < 400) {
    return refusal("redirect", `the endpoint answered with a redirect (${status}); it is refused`);
  }
  return { ok: true };
}

/**
 * F109-FR-018 — a secret reaches a harness by the environment or by
 * standard input and NEVER in an argument list. `secret` is the value; any
 * argument that carries it refuses the call before the harness starts.
 */
export function guardSecretOutOfArguments(secret: string, args: readonly string[]): GuardResult {
  for (const argument of args) {
    if (argument.includes(secret)) {
      return refusal("secret-in-arguments", "a secret must never be passed in an argument list");
    }
  }
  return { ok: true };
}

export type ModelListResult =
  | {
      readonly ok: true;
      /** The model ids the endpoint listed. Never logged, never stored. */
      readonly models: readonly string[];
      /** How long the read took, in milliseconds. */
      readonly tookMs: number;
    }
  | GuardRefusal;

/**
 * F109-FR-018 — the free read-only request for a model list: method GET,
 * the credential attached, at most 3 seconds (the limit is clamped, never
 * raised), redirects refused, and the value is handed to the caller only —
 * this module stores nothing and logs nothing.
 */
export function listModels(input: {
  /** The full address of the model list, from the descriptor. */
  readonly url: string;
  readonly credential?: string | null;
  /** Header names per scheme, from the descriptor. */
  readonly scheme?: "bearer" | "x-api-key" | "none";
  /** The time limit in milliseconds; clamped to `MAX_MODEL_LIST_MS`. */
  readonly timeoutMs?: number;
}): Promise<ModelListResult> {
  const address = guardAddress(input.url);
  if (!address.ok) return Promise.resolve(address);
  const timeoutMs = Math.min(input.timeoutMs ?? MAX_MODEL_LIST_MS, MAX_MODEL_LIST_MS);
  const headers: Record<string, string> = { accept: "application/json" };
  if (input.credential && input.scheme === "x-api-key") {
    headers["x-api-key"] = input.credential;
  } else if (input.credential && input.scheme !== "none") {
    headers.authorization = `Bearer ${input.credential}`;
  }
  const startedAt = Date.now();
  return new Promise<ModelListResult>((resolveList) => {
    const request = httpRequest(
      input.url,
      { method: "GET", headers, timeout: timeoutMs },
      (response) => {
        const redirect = guardRedirect(response.statusCode ?? 0);
        if (!redirect.ok) {
          response.resume();
          resolveList(redirect);
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => {
          let models: string[] = [];
          try {
            const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (
              typeof parsed === "object" &&
              parsed !== null &&
              Array.isArray((parsed as { data?: unknown }).data)
            ) {
              models = (parsed as { data: unknown[] }).data
                .map((entry) =>
                  typeof entry === "object" &&
                  entry !== null &&
                  typeof (entry as { id?: unknown }).id === "string"
                    ? (entry as { id: string }).id
                    : null,
                )
                .filter((id): id is string => id !== null);
            } else if (Array.isArray(parsed)) {
              models = parsed.filter((e): e is string => typeof e === "string");
            }
          } catch {
            models = [];
          }
          resolveList({ ok: true, models, tookMs: Date.now() - startedAt });
        });
        response.on("error", () => {
          resolveList(refusal("transport-failed", "the model list failed to read"));
        });
      },
    );
    request.on("timeout", () => {
      request.destroy();
      resolveList(
        refusal("model-list-timeout", `the model list did not end within ${timeoutMs} ms`),
      );
    });
    request.on("error", () => {
      resolveList(refusal("transport-failed", "the model list could not be requested"));
    });
    request.end();
  });
}
