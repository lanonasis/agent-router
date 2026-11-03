import { useState } from "react";
import type { AgentType } from "@/types/agent";
import { useRouterSettings } from "@/lib/routerSettings";
import type { ProfileManifest } from "@/lib/profileManifest";
import { useRouterCatalog } from "@/services/profileTestService";
import { ProfileBuilder } from "@/components/profile-builder/ProfileBuilder";
import { ProfileTestConsole } from "@/components/profile-builder/ProfileTestConsole";

/** Best-guess router lane for an agent role, used only to preselect the test console. */
const ROLE_LANE: Record<string, string> = {
  Coder: "code-assist",
  Reviewer: "code-assist",
  Tester: "code-assist",
  Researcher: "memory-analysis",
  Architect: "ask-ai",
  Orchestrator: "ask-ai",
};

export function AgentProfileTab({ agent }: { agent: AgentType }) {
  const settings = useRouterSettings();
  const catalogState = useRouterCatalog(settings);
  const catalog = catalogState.catalog;
  const [manifest, setManifest] = useState<ProfileManifest | null>(null);

  const mappedLane = (agent.role && ROLE_LANE[agent.role]) || "ask-ai";
  const initialTask = agent.purpose || agent.description || "";

  return (
    <div className="space-y-6">
      <ProfileBuilder
        manifest={manifest}
        onManifestChange={setManifest}
        catalog={catalog}
        catalogNote={catalogState.note}
        settings={settings}
        initialTask={initialTask}
      />
      <ProfileTestConsole
        settings={settings}
        catalog={catalog}
        defaultUseCase={manifest?.boundUseCase || mappedLane}
        profileId={manifest?.profileId ?? null}
      />
    </div>
  );
}

export default AgentProfileTab;
