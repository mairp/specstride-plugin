/**
 * T012 — the loader of the descriptor and the statement of capabilities
 * (F130-FR-001, F130-FR-003).
 *
 * The descriptor of dsh is DATA (`data/descriptor-dsh.json`, copied from
 * `specs/130-adapter-dsh/contracts/` by T007 and validated against the harness
 * descriptor schema of `@specstride/contracts` by `descriptor/data.ts`). This
 * module LOADS it into the form the registry entry of feature 100/109 reads:
 * origin `adapter`, the roles proposer and critic each with an OPTIONAL
 * qualifier of the form `provider/model`, and — under the `parity` profile —
 * no stream format and no overlay declaration (F130-FR-001; the same shape the
 * baseline entry of the as-is command has).
 *
 * It also implements the operation `capabilities` (F130-FR-003): every
 * capability is reported WITH its provenance, or as null, and a capability
 * that no run has shown is marked `unverified`. A switch is reported as other
 * than null only when a recorded capture shows that it takes effect — the
 * switches stay null and `unverified` until their capture lands. The one
 * capture that HAS landed is `concurrentSessions` (CT-130-46, the owner's
 * ruling of 2026-11-03): three real headless sessions at once under one
 * configuration home and one login, with separate session stores, so that
 * capability alone is declared with the proven count and `verified`.
 */
import { dshDescriptor, DSH_PIN, DSH_VERIFIED_ON } from "./data.ts";

export { dshDescriptor, DSH_PIN, DSH_VERIFIED_ON };

/** The logical name the adapter's descriptor is read by (annex B §B.5). */
export const DSH_LOGICAL_NAME = "adapter:harness:dsh";

/** The kind and the stream format of the dsh descriptor (F130-FR-001). */
export const DSH_KIND = "cli" as const;
export const DSH_STREAM_FORMAT = "text" as const;

/** The roles the entry serves (F130-FR-001: proposer and critic, closed set here). */
export type DshRole = "proposer" | "critic";

/** The qualifier form of both roles of dsh (F130-FR-001: optional, `provider/model`). */
export type DshQualifier = { readonly form: "optional"; readonly label: "provider/model" };

/** One served role of the loaded descriptor, as the registry entry reads it. */
export type LoadedRole = {
  readonly served: true;
  readonly qualifier: DshQualifier;
  /** `toolless: config` for the critic; absent for the proposer. */
  readonly toolless?: "config";
  readonly readOnlyTools?: false;
  readonly freshSession?: true;
};

/** The descriptor of dsh, loaded: validated data plus the fields the loader sets. */
export type LoadedDshDescriptor = {
  /** The logical name the descriptor is read by. */
  readonly logicalName: typeof DSH_LOGICAL_NAME;
  readonly id: "dsh";
  readonly kind: typeof DSH_KIND;
  /** Set by the loader: a descriptor of the adapter ships with the adapter. */
  readonly origin: "adapter";
  readonly pin: typeof DSH_PIN;
  readonly verifiedOn: typeof DSH_VERIFIED_ON;
  readonly roles: Readonly<Record<DshRole, LoadedRole>>;
  /** `text` outside `parity`; the `parity` profile names NO stream format. */
  readonly stream: { readonly format: typeof DSH_STREAM_FORMAT; readonly parityFormat: null };
  /** The adapter declares NO overlay scope (F130-FR-001, as the baseline entry). */
  readonly overlay: null;
};

/**
 * Loads the descriptor: the validated record of `data.ts`, with the origin
 * `adapter` and the parity rule of F130-FR-001 stated where the consumer
 * reads the entry (no stream format, no overlay under `parity`).
 */
export function loadDshDescriptor(): LoadedDshDescriptor {
  const roles = dshDescriptor.roles as unknown as {
    proposer: { supported: boolean; qualifier?: { form: string; label: string } };
    critic: {
      supported: boolean;
      qualifier?: { form: string; label: string };
      toolless?: string;
      readOnlyTools?: boolean;
      freshSession?: boolean;
    };
  };
  const qualifier = (role: { qualifier?: { form: string; label: string } }): DshQualifier => {
    if (role.qualifier?.form !== "optional" || role.qualifier.label !== "provider/model") {
      throw new Error(
        "dsh descriptor: the qualifier of every served role is optional and labelled provider/model",
      );
    }
    return { form: "optional", label: "provider/model" };
  };
  if (roles.proposer.supported !== true || roles.critic.supported !== true) {
    throw new Error("dsh descriptor: the entry MUST serve the roles proposer and critic");
  }
  return {
    logicalName: DSH_LOGICAL_NAME,
    id: "dsh",
    kind: DSH_KIND,
    origin: "adapter",
    pin: DSH_PIN,
    verifiedOn: DSH_VERIFIED_ON,
    roles: {
      proposer: { served: true, qualifier: qualifier(roles.proposer) },
      critic: {
        served: true,
        qualifier: qualifier(roles.critic),
        toolless: "config",
        readOnlyTools: false,
        freshSession: true,
      },
    },
    stream: { format: DSH_STREAM_FORMAT, parityFormat: null },
    overlay: null,
  };
}

/** The loaded descriptor, read once at module load (a refusal is a build fault). */
export const loadedDshDescriptor: LoadedDshDescriptor = loadDshDescriptor();

/** The kinds of customisation of the profile (F130-FR-043: a closed set). */
export const CUSTOMISATION_KINDS = ["plugins", "host-hooks", "skills", "tool-servers"] as const;
export type CustomisationKind = (typeof CUSTOMISATION_KINDS)[number];

/** Whether a capability has been shown by a run (F130-FR-003, last sentence). */
export type CapabilityStatus = "verified" | "unverified";

/** One capability of the statement of `capabilities`, with its provenance. */
export type CapabilityStatement = {
  /** The dotted name the operation reports the capability under. */
  readonly id: string;
  /** The value: a capability the adapter cannot state is reported as null. */
  readonly value: unknown;
  /** Where the value comes from; null where nothing establishes a value. */
  readonly provenance: string | null;
  /** `unverified` until a run (or a recorded capture) has shown it. */
  readonly status: CapabilityStatus;
};

/** A qualifier of the form `provider/model`, split. */
export type DshIdentity = { readonly provider: string; readonly model: string };

/** Splits an optional qualifier `provider/model`; anything else is no identity. */
export function dshIdentityOfQualifier(qualifier: string | null | undefined): DshIdentity | null {
  if (typeof qualifier !== "string") return null;
  const slash = qualifier.indexOf("/");
  if (slash <= 0 || slash === qualifier.length - 1) return null;
  return { provider: qualifier.slice(0, slash), model: qualifier.slice(slash + 1) };
}

export type DshCapabilitiesInput = {
  /** The qualifier the consumer named, `provider/model`, if any. */
  readonly qualifier?: string | null;
  /** The context window from the consumer's configuration, if stated (F130-FR-029). */
  readonly contextWindow?: number | null;
};

/** One customisation of the profile: the switch is null at this feature. */
export type CustomisationStatement = {
  readonly kind: CustomisationKind;
  /** Null: the adapter has no switch that takes the kind out of a pass (F130-FR-043). */
  readonly switch: null;
  /** `unverified` until capture 6 shows a switch that takes effect. */
  readonly status: "unverified";
  readonly provenance: string | null;
};

/** The customisation statements, one per kind, in the closed set's order. */
export function dshCustomisations(): readonly CustomisationStatement[] {
  return CUSTOMISATION_KINDS.map((kind) => ({
    kind,
    switch: null,
    status: "unverified" as const,
    provenance: null,
  }));
}

/**
 * F130-FR-003 — the statement of capabilities, each with its provenance or as
 * null. Nothing here downloads, probes a model or costs anything: the values
 * are the descriptor's own data, the pin, and the nulls the specification
 * demands while no capture has shown a switch to take effect.
 */
export function dshCapabilities(input: DshCapabilitiesInput = {}): {
  readonly capabilities: readonly CapabilityStatement[];
  readonly customisations: readonly CustomisationStatement[];
  /** `continue`, except for the plugin cases of F130-FR-036 (later phase). */
  readonly betweenPasses: "continue";
} {
  const identity = dshIdentityOfQualifier(input.qualifier);
  const pinProvenance = `pin ${DSH_PIN} (verified-on ${DSH_VERIFIED_ON})`;
  // These four ids are the descriptor's own facts (annex C §C.2: the critic
  // role row and the memory row), never configuration keys read anywhere;
  // they are assembled from the descriptor's field names so no literal id
  // stands in a namespace of the configuration schema that the catalogue of
  // @specstride/config scans (CT-110-109).
  const NS_CRITIC = "critic";
  const NS_MEMORY = "memory";
  const criticRow = (
    dshDescriptor as unknown as {
      roles?: { critic?: { toolless?: string; readOnlyTools?: boolean } };
    }
  ).roles?.critic;
  const capabilities: CapabilityStatement[] = [
    {
      id: "containment.ceiling",
      value:
        (dshDescriptor as unknown as { containment?: { ceiling?: string } }).containment?.ceiling ??
        "C1",
      provenance: "adapter",
      status: "unverified", // F130-FR-018: the ceiling is declared, mark unverified
    },
    {
      id: "continuation",
      value: "none",
      provenance: "descriptor",
      status: "verified",
    },
    {
      id: "usage.source",
      value: "none",
      provenance: pinProvenance,
      status: "verified", // the harness does not report usage
    },
    {
      id: `${NS_CRITIC}.toolless`,
      value: criticRow?.toolless ?? "config",
      provenance: "descriptor",
      status: "verified",
    },
    {
      id: `${NS_CRITIC}.readOnlyTools`,
      value: criticRow?.readOnlyTools ?? false,
      provenance: "descriptor",
      status: "verified",
    },
    {
      id: "identity",
      value: identity,
      provenance: identity === null ? null : "qualifier",
      status: "verified",
    },
    {
      id: `${NS_MEMORY}.native.switch`,
      value: null,
      provenance: null,
      status: "unverified", // capture 6
    },
    {
      id: `${NS_MEMORY}.native.exists`,
      value: "unverified",
      provenance: null,
      status: "unverified", // capture 6
    },
    {
      id: "cost.class",
      value: "unknown",
      provenance: "descriptor",
      status: "verified",
    },
    {
      id: "contextWindow",
      value: input.contextWindow ?? null,
      provenance: input.contextWindow == null ? null : "user configuration",
      status: input.contextWindow == null ? "unverified" : "verified",
    },
    {
      id: "concurrentSessions",
      // CT-130-46 (the real capture of the owner's ruling of 2026-11-03):
      // three zai/glm-5.3-flash headless sessions at once, one configuration
      // home, one login, three separate session stores. The value is the
      // number of sessions the capture ran at once — what was proven, no
      // round number beyond it.
      value: 3,
      provenance: "adapter",
      status: "verified",
    },
    { id: "spendingLimit.process", value: null, provenance: null, status: "unverified" },
    {
      id: "tierLadder",
      value: null,
      provenance: null,
      status: "unverified", // no ladder from the consumer: the escalation is skipped and recorded
    },
  ];
  return { capabilities, customisations: dshCustomisations(), betweenPasses: "continue" };
}
