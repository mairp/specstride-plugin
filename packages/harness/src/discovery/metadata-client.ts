/**
 * T020 — the metadata client of discovery (F146-FR-008; D-4 of the plan).
 *
 * The metadata pass makes GET requests only. It MAY send the credential of
 * a candidate to the model-list endpoint that the harness descriptor of
 * that candidate names, and to NO OTHER HOST: a request to a host the
 * descriptor does not name is refused before any byte is sent. It refuses
 * every redirect of the 3xx class and follows none, so the credential
 * cannot reach a second host (D-4, R20 F16).
 *
 * The value of the credential is resolved at the moment of use, registered
 * with the redactor, and never stored, logged or written to a finding or
 * an event: the client keeps only the method, the URL and the status in
 * its trace, and no header ever.
 */
import type { CandidateFinding } from "./types.ts";
import { loadProbeLimits, type ProbeLimits } from "./probes/runner.ts";
import type { MetadataFetch, MetadataFetchResponse, RedactorPort } from "./ports.ts";
import type { SecretResolver } from "@specstride/contracts/ep/secret-resolver";

/** The requirement this module carries. */
export const METADATA_CLIENT_REQUIREMENT = "F146-FR-008" as const;

/** The outcomes of a request of the metadata pass. */
export type MetadataOutcome =
  "ok" | "redirect-refused" | "request-failed" | "no-credential" | "host-not-allowed";

/** What one request of the metadata pass answered. No credential value. */
export type MetadataResult = {
  readonly outcome: MetadataOutcome;
  /** The models the model list named, where the outcome is `ok`. */
  readonly models: readonly string[];
  /** A window value the list stated, or null (the window rule is F146-FR-016). */
  readonly windowTokens: number | null;
  readonly status: number | null;
  /** The one doctor finding of a refused or failed request, or null. */
  readonly finding: CandidateFinding | null;
};

/** One recorded request: method, URL and status. Never a header, never a body. */
export type MetadataTraceEntry = {
  readonly method: "GET";
  readonly url: string;
  readonly status: number | null;
  /** Why no request was sent at all, where none was. */
  readonly refusedBeforeRequest?: "host-not-allowed" | "no-credential";
};

/** The header a credential scheme travels in. */
function headerOf(scheme: string, value: string): Record<string, string> {
  if (scheme === "x-api-key") return { "x-api-key": value };
  return { authorization: `Bearer ${value}` };
}

/**
 * The default fetch port: the `fetch` the runtime ships, with
 * `redirect: "manual"` so no redirect is ever followed (D-4), bounded by
 * the request time limit of `data/probe-limits.json`.
 */
export const defaultMetadataFetch: MetadataFetch = async (request) => {
  const limits: ProbeLimits = loadProbeLimits();
  const response = await fetch(request.url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(limits.requestTimeLimitMs),
    headers: request.headers,
  });
  const headers: Record<string, string> = {};
  const location = response.headers.get("location");
  if (location !== null) headers["location"] = location;
  const payload: MetadataFetchResponse = {
    status: response.status,
    location: headers["location"],
    text: response.status >= 300 && response.status < 400 ? null : await response.text(),
  };
  return payload;
};

/**
 * The client of the metadata pass. One instance per discovery run; the
 * trace holds every request it made or refused.
 */
export class MetadataClient {
  readonly #resolver: SecretResolver;
  readonly #fetch: MetadataFetch;
  readonly #redactor: RedactorPort | null;
  #trace: MetadataTraceEntry[] = [];

  constructor(deps: {
    readonly resolver: SecretResolver;
    /** Another fetch, for a test; the runtime `fetch` by default. */
    readonly fetch?: MetadataFetch;
    /** The redactor the resolved value is registered with. */
    readonly redactor?: RedactorPort;
  }) {
    this.#resolver = deps.resolver;
    this.#fetch = deps.fetch ?? defaultMetadataFetch;
    this.#redactor = deps.redactor ?? null;
  }

  /** Every request this client made or refused. No credential value. */
  get trace(): readonly MetadataTraceEntry[] {
    return this.#trace;
  }

  /**
   * Ask one model list. The credential goes only to `allowedHost` — the
   * host the harness descriptor of the candidate names — and the request
   * is a GET. A status of the 3xx class is a refused redirect: no second
   * request is made, the models stay empty, and the value of the
   * credential has gone nowhere.
   */
  async fetchModelList(input: {
    readonly url: string;
    /** The credential reference, e.g. `env:EXAMPLE_ENDPOINT_KEY`, or null. */
    readonly credentialReference?: string | null;
    /** The host the harness descriptor names; the only host that is asked. */
    readonly allowedHost: string;
  }): Promise<MetadataResult> {
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      const finding: CandidateFinding = {
        code: "metadata-url-invalid",
        message: "the model list holds no address that can be asked",
      };
      this.#trace.push({ method: "GET", url: input.url, status: null });
      return { outcome: "request-failed", models: [], windowTokens: null, status: null, finding };
    }
    // The credential is bound to its host: a request to any other host is
    // refused before anything is sent (F146-FR-008).
    if (parsed.host !== input.allowedHost) {
      this.#trace.push({
        method: "GET",
        url: input.url,
        status: null,
        refusedBeforeRequest: "host-not-allowed",
      });
      return {
        outcome: "host-not-allowed",
        models: [],
        windowTokens: null,
        status: null,
        finding: {
          code: "metadata-host-not-allowed",
          message: `the model list is not on the host the harness descriptor names (${input.allowedHost})`,
        },
      };
    }
    let headers: Record<string, string> = {};
    if (input.credentialReference !== undefined && input.credentialReference !== null) {
      const scheme = input.credentialReference.slice(0, input.credentialReference.indexOf(":"));
      let existence: "yes" | "no" | "unprobed";
      try {
        existence = await this.#resolver.exists(input.credentialReference);
      } catch {
        existence = "unprobed";
      }
      if (existence !== "yes") {
        this.#trace.push({
          method: "GET",
          url: input.url,
          status: null,
          refusedBeforeRequest: "no-credential",
        });
        return {
          outcome: "no-credential",
          models: [],
          windowTokens: null,
          status: null,
          finding: {
            code: "metadata-no-credential",
            message: "the credential the harness descriptor names is not present",
          },
        };
      }
      // The value is resolved at the moment of use, registered with the
      // redactor, and held in no field, log line, trace entry or finding.
      const resolved = await this.#resolver.resolve(input.credentialReference);
      this.#redactor?.register(resolved.value, `credential of ${parsed.host}`);
      headers = headerOf(scheme ?? "bearer", resolved.value);
    }
    let response: MetadataFetchResponse;
    try {
      response = await this.#fetch({ url: input.url, method: "GET", headers });
    } catch (error) {
      this.#trace.push({ method: "GET", url: input.url, status: null });
      return {
        outcome: "request-failed",
        models: [],
        windowTokens: null,
        status: null,
        finding: {
          code: "metadata-request-failed",
          message: `the model list could not be asked: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      };
    }
    // Every redirect of the 3xx class is refused; none is followed (D-4).
    if (response.status >= 300 && response.status < 400) {
      this.#trace.push({ method: "GET", url: input.url, status: response.status });
      return {
        outcome: "redirect-refused",
        models: [],
        windowTokens: null,
        status: response.status,
        finding: {
          code: "metadata-redirect-refused",
          message: `the model list answered with the redirect status ${response.status}; it was refused`,
        },
      };
    }
    if (response.status < 200 || response.status >= 300) {
      this.#trace.push({ method: "GET", url: input.url, status: response.status });
      return {
        outcome: "request-failed",
        models: [],
        windowTokens: null,
        status: response.status,
        finding: {
          code: "metadata-request-failed",
          message: `the model list answered with the status ${response.status}`,
        },
      };
    }
    const models = modelsOfBody(response.text);
    this.#trace.push({ method: "GET", url: input.url, status: response.status });
    return { outcome: "ok", models, windowTokens: null, status: response.status, finding: null };
  }
}

/**
 * The model names of a model list body (an OpenAI-style `{"data": [...]}`),
 * or of a bare JSON array of strings. Names the body does not give as
 * strings are dropped; nothing else of the body is kept.
 */
export function modelsOfBody(text: string | null): readonly string[] {
  if (text === null || text.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const rows: readonly unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed !== null &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { data?: unknown }).data)
      ? ((parsed as { data: unknown[] }).data as readonly unknown[])
      : [];
  const models: string[] = [];
  for (const row of rows) {
    const name =
      typeof row === "string"
        ? row
        : row !== null &&
            typeof row === "object" &&
            typeof (row as { id?: unknown }).id === "string"
          ? (row as { id: string }).id
          : undefined;
    if (name !== undefined) models.push(name);
  }
  return models;
}
