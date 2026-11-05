/**
 * Test helpers for the tests of discovery (feature 146). This file is not
 * a test; the runner picks up only `*.test.*`.
 */
import type { SecretResolver } from "@specstride/contracts/ep/secret-resolver";
import type {
  MetadataFetch,
  MetadataFetchRequest,
  MetadataFetchResponse,
} from "../../src/discovery/ports.ts";

/**
 * A secret resolver a test drives: it answers `exists` from a map, hands
 * out values from a map, and records which operation was asked, so a test
 * can prove the reader asked for `exists` only.
 */
export function fakeResolver(
  answers: Readonly<Record<string, "yes" | "no" | "unprobed">> = {},
  values: Readonly<Record<string, string>> = {},
): SecretResolver & {
  readonly existsCalls: string[];
  readonly resolveCalls: string[];
  readonly operationsAsked: string[];
} {
  const existsCalls: string[] = [];
  const resolveCalls: string[] = [];
  const operationsAsked: string[] = [];
  return {
    existsCalls,
    resolveCalls,
    operationsAsked,
    handles(scheme: string): boolean {
      operationsAsked.push("handles");
      return scheme === "env:";
    },
    exists(reference: string): Promise<"yes" | "no" | "unprobed"> {
      operationsAsked.push("exists");
      existsCalls.push(reference);
      return Promise.resolve(answers[reference] ?? "no");
    },
    resolve(reference: string): Promise<{ value: string; registeredWithTheRedactor: true }> {
      operationsAsked.push("resolve");
      resolveCalls.push(reference);
      const value = values[reference];
      if (value === undefined) return Promise.reject(new Error(`no value for ${reference}`));
      return Promise.resolve({ value, registeredWithTheRedactor: true });
    },
    boundHost(reference: string): string | null {
      operationsAsked.push("boundHost");
      return reference.startsWith("env:") ? null : null;
    },
  };
}

/** A fetch for the metadata client that a test drives and traces. */
export function fakeFetch(
  respond: (
    request: MetadataFetchRequest,
  ) => MetadataFetchResponse | Promise<MetadataFetchResponse>,
): MetadataFetch & { readonly calls: MetadataFetchRequest[] } {
  const calls: MetadataFetchRequest[] = [];
  const fetchIt = async (request: MetadataFetchRequest): Promise<MetadataFetchResponse> => {
    calls.push(request);
    return respond(request);
  };
  return Object.assign(fetchIt, { calls });
}
