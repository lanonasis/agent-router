import type { ReactNode } from "react";
import { Radio, Waves, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { LivePersona, LiveProfile } from "@/services/routerCatalog";

// Status is conveyed by the label text as well as colour.
const STATUS: Record<LivePersona["status"], { label: string; cls: string; dot: string }> = {
  active: { label: "Active", cls: "border-success/40 text-success", dot: "bg-success" },
  degraded: { label: "Degraded", cls: "border-warning/40 text-warning", dot: "bg-warning" },
  unavailable: { label: "Unavailable", cls: "border-destructive/40 text-destructive", dot: "bg-destructive" },
};

function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] px-2 py-0.5 rounded-full bg-bgMuted text-fgMuted border border-border/50 font-mono">
      {children}
    </span>
  );
}

export function LivePersonaCard({ persona, documented }: { persona: LivePersona; documented?: boolean }) {
  const s = STATUS[persona.status] ?? STATUS.unavailable;
  const { available, declared } = persona.servingCapacity;
  return (
    <Card className="h-full border-l-[3px] border-l-brandBlue">
      <CardContent className="p-5 flex flex-col h-full gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-fg truncate">{persona.useCase}</h3>
            {persona.role && <p className="text-[11px] text-fgMuted capitalize">{persona.role}</p>}
          </div>
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 gap-1 ${s.cls}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
            {s.label}
          </Badge>
        </div>
        <p className="text-sm text-fgMuted/80 line-clamp-3 leading-relaxed">{persona.description}</p>
        {persona.tools.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="Default tools">
            {persona.tools.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </div>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 border-t border-border/50 text-[11px] text-fgMuted">
          <span className="flex items-center gap-1" title="Usable slots / declared slots">
            <Layers className="h-3 w-3" aria-hidden="true" />
            {available}/{declared} slots
          </span>
          <span className="flex items-center gap-1">
            {persona.streamable ? (
              <Waves className="h-3 w-3" aria-hidden="true" />
            ) : (
              <Radio className="h-3 w-3" aria-hidden="true" />
            )}
            {persona.streamable ? "Streamable" : "Not streamable"}
          </span>
          {persona.laneKey && <span className="font-mono truncate">lane: {persona.laneKey}</span>}
          {documented !== undefined && (
            <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 border-border text-fgMuted">
              {documented ? "Synced" : "Live only"}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function LiveProfileCard({ profile }: { profile: LiveProfile }) {
  return (
    <Card className="h-full border-l-[3px] border-l-brandPink">
      <CardContent className="p-5 flex flex-col h-full gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-fg truncate">{profile.profileId}</h3>
            <p className="text-[11px] text-fgMuted">
              Profile v{profile.version} · {profile.status}
            </p>
          </div>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 border-border text-fgMuted">
            Profile
          </Badge>
        </div>
        <p className="text-xs text-fgMuted">
          Bound to <span className="font-mono text-fg">{profile.boundUseCase}</span>
        </p>
        {profile.allowedTools.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="Allowed tools">
            {profile.allowedTools.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
