/**
 * T019 — the ports of the source readers that the composition root hands
 * in. Everything that touches the machine outside the guarded reader and
 * the probe runner goes through one of these ports, so a test replaces it
 * and traces it (plan: "three narrow ports").
 */

/** An entry a host registers: a name and a type, and NOTHING else (F146-FR-005). */
export type HostEntry = {
  readonly name: string;
  readonly type: string;
};

/**
 * The reader of the entries a host registers. The composition root hands
 * it in; discovery never reads the values of the environment, of headers
 * or of arguments to fill it.
 */
export type HostEntryReader = () => readonly HostEntry[] | Promise<readonly HostEntry[]>;

/** The port where no host integration is wired: it registers nothing. */
export const noHostEntries: HostEntryReader = () => [];

/**
 * A tested harness adapter that ships with the product (source
 * `harness-adapter`). The adapter detects its own harness, and only by
 * what its `detect` names.
 */
export type TestedAdapter = {
  readonly id: string;
  readonly kind: string;
  readonly detect: {
    readonly executable?: string;
    readonly variables?: readonly string[];
  };
  /** `provider.termsRef` of the adapter's descriptor, or null where unknown. */
  readonly termsRef?: string | null;
};

/** The adapters that ship, as data. This slice ships none yet. */
export const SHIPPED_TESTED_ADAPTERS: readonly TestedAdapter[] = Object.freeze([]);

/**
 * One request the metadata client sends, as a port sees it. The method is
 * always `GET` (F146-FR-008); the credential travels in the headers, and
 * the port never returns them.
 */
export type MetadataFetchRequest = {
  readonly url: string;
  readonly method: "GET";
  readonly headers?: Readonly<Record<string, string>>;
};

/** What a fetch port answers: a status, the few headers the client needs, a body. */
export type MetadataFetchResponse = {
  readonly status: number;
  readonly location?: string;
  readonly text: string | null;
};

/** The fetch port of the metadata client (D-4: the `fetch` of the runtime). */
export type MetadataFetch = (request: MetadataFetchRequest) => Promise<MetadataFetchResponse>;

/**
 * The redactor, as the metadata client sees it. The resolved value of a
 * credential is registered here at the moment of use (F146-FR-008).
 */
export type RedactorPort = {
  register(value: string, label: string): void;
};

/** Where the doctor warning of an ignored entry goes (F146-FR-010). */
export type DiscoveryPrinter = (line: string) => void;
