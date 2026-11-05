/**
 * T021 — the dependency types of a run of discovery, gathered so that
 * `discover.ts` stays readable. Every port here is handed in by the
 * composition root and replaced by a test.
 */
import type { GatewayVariable } from "./sources/gateway.ts";
import type {
  DiscoveryPrinter,
  HostEntryReader,
  MetadataFetch,
  RedactorPort,
  TestedAdapter,
} from "./ports.ts";

export type { DiscoveryPrinter, HostEntryReader, MetadataFetch, RedactorPort, TestedAdapter };
/** A gateway variable of the host: a NAME, an address, never a value. */
export type GatewayVariableInfo = GatewayVariable;
export { SHIPPED_TESTED_ADAPTERS, noHostEntries } from "./ports.ts";
