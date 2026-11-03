import type { AgentType } from "@/types/agent";
import type { LivePersona, LiveProfile, RouterCatalog } from "@/services/routerCatalog";

/**
 * Reconciles documentation-defined agents with what the router actually serves.
 * Pure: no I/O, no clock. Carries no vendor or model identifiers.
 */
export type SyncState = "synced" | "doc-only" | "live-only";

export type SyncEntry =
  | { state: "synced" | "doc-only"; kind: "agent"; agent: AgentType; personas: LivePersona[]; profiles: LiveProfile[] }
  | { state: "live-only"; kind: "persona"; persona: LivePersona }
  | { state: "live-only"; kind: "profile"; profile: LiveProfile };

const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

export function reconcile(docAgents: AgentType[], catalog: RouterCatalog | null | undefined): SyncEntry[] {
  const personas = catalog?.personas ?? [];
  const profiles = catalog?.profiles ?? [];
  const usedPersonas = new Set<string>();
  const usedProfiles = new Set<string>();
  const entries: SyncEntry[] = [];

  for (const agent of docAgents) {
    const keys = new Set([norm(agent.role), norm(agent.id)].filter(Boolean));
    const role = norm(agent.role);
    const matchedPersonas = role ? personas.filter((p) => norm(p.role) === role) : [];
    const matchedProfiles = profiles.filter(
      (p) => keys.has(norm(p.profileId)) || keys.has(norm(p.applicationId)),
    );
    matchedPersonas.forEach((p) => usedPersonas.add(p.useCase));
    matchedProfiles.forEach((p) => usedProfiles.add(p.profileId));
    entries.push({
      state: matchedPersonas.length || matchedProfiles.length ? "synced" : "doc-only",
      kind: "agent",
      agent,
      personas: matchedPersonas,
      profiles: matchedProfiles,
    });
  }

  for (const persona of personas) {
    if (!usedPersonas.has(persona.useCase)) entries.push({ state: "live-only", kind: "persona", persona });
  }
  for (const profile of profiles) {
    if (!usedProfiles.has(profile.profileId)) entries.push({ state: "live-only", kind: "profile", profile });
  }
  return entries;
}

export function summarise(entries: SyncEntry[]) {
  const agentEntries = entries.filter((e) => e.kind === "agent");
  return {
    documentedNotServed: agentEntries.filter((e) => e.state === "doc-only").length,
    documentedSynced: agentEntries.filter((e) => e.state === "synced").length,
    liveOnly: entries.filter((e) => e.state === "live-only").length,
  };
}

/** Map of documented agent id -> sync state, for per-card badges. */
export function agentSyncStates(entries: SyncEntry[]): Map<string, "synced" | "doc-only"> {
  const m = new Map<string, "synced" | "doc-only">();
  for (const e of entries) if (e.kind === "agent") m.set(e.agent.id, e.state as "synced" | "doc-only");
  return m;
}
