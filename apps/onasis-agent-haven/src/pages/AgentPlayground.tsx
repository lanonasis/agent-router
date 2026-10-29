import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Brain,
  CircleStop,
  FileCode2,
  KeyRound,
  Play,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MarkdownRenderer } from "@/components/docs/MarkdownRenderer";
import { getDocumentedAgents } from "@/services/agentService";
import { TOOL_REGISTRY, TOOL_REGISTRY_SOURCE, type ApprovalLevel, type RegistryTool } from "@/data/toolRegistry";
import {
  ROUTING_USE_CASES,
  composePersonaPrompt,
  defaultToolsForAgent,
  toolsNamedInAgentDoc,
  type RoutingUseCase,
} from "@/lib/playgroundPersona";
import { hasRouterCredential, useRouterSettings } from "@/lib/routerSettings";
import {
  PlaygroundError,
  fetchPlaygroundModels,
  streamPlayground,
  type PlaygroundEvent,
  type PlaygroundModel,
} from "@/services/playgroundService";

// ── Types ────────────────────────────────────────────────────────────────

type Part =
  | { kind: "reasoning"; text: string }
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; input: unknown; approval: ApprovalLevel | null; output?: unknown };

interface UserTurn { id: string; role: "user"; content: string }
interface AssistantTurn {
  id: string;
  role: "assistant";
  persona: string;
  model: string;
  simulate: boolean;
  parts: Part[];
  status: "streaming" | "done" | "error" | "stopped";
  error?: string;
  finish?: Extract<PlaygroundEvent, { type: "finish" }>;
  startedAt: number;
  durationMs?: number;
}
type Turn = UserTurn | AssistantTurn;

const APPROVAL_TONE: Record<ApprovalLevel, string> = {
  auto: "border-success/50 text-success",
  notify: "border-brandBlue/50 text-brandBlue",
  approve: "border-warning/50 text-warning",
  critical: "border-destructive/50 text-destructive",
};

const uid = () => Math.random().toString(36).slice(2, 10);
const fmtJson = (v: unknown) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
};

function applyEvent(a: AssistantTurn, e: PlaygroundEvent): AssistantTurn {
  const parts = [...a.parts];
  const last = parts[parts.length - 1];
  switch (e.type) {
    case "text":
      if (last?.kind === "text") parts[parts.length - 1] = { ...last, text: last.text + e.text };
      else parts.push({ kind: "text", text: e.text });
      return { ...a, parts };
    case "reasoning":
      if (last?.kind === "reasoning") parts[parts.length - 1] = { ...last, text: last.text + e.text };
      else parts.push({ kind: "reasoning", text: e.text });
      return { ...a, parts };
    case "tool-call":
      parts.push({ kind: "tool", id: e.id, name: e.name, input: e.input, approval: e.approval });
      return { ...a, parts };
    case "tool-result":
      return { ...a, parts: parts.map((p) => (p.kind === "tool" && p.id === e.id ? { ...p, output: e.output } : p)) };
    case "finish":
      return { ...a, finish: e };
    case "error":
      return e.status === 499 ? { ...a, status: "stopped" } : { ...a, status: "error", error: e.message };
    default:
      return a;
  }
}

/** Plain user/assistant history (no tool items) — what the next turn resends. */
type HistoryMessage = { role: "user" | "assistant"; content: string };
function toMessages(turns: Turn[]): HistoryMessage[] {
  return turns.flatMap((t): HistoryMessage[] => {
    if (t.role === "user") return [{ role: "user", content: t.content }];
    const text = t.parts.filter((p) => p.kind === "text").map((p) => (p as { text: string }).text).join("").trim();
    const calls = t.parts.filter((p) => p.kind === "tool").map((p) => (p as { name: string }).name);
    const content = text || (calls.length ? `(called ${calls.join(", ")})` : "");
    return content ? [{ role: "assistant", content }] : [];
  });
}

// ── Small pieces ─────────────────────────────────────────────────────────

function ApprovalBadge({ level }: { level: ApprovalLevel }) {
  return (
    <span className={`rounded border px-1.5 py-px font-mono text-[10px] leading-4 ${APPROVAL_TONE[level]}`}>{level}</span>
  );
}

function ToolCallCard({ part, simulate }: { part: Extract<Part, { kind: "tool" }>; simulate: boolean }) {
  const output = part.output as { status?: string } | undefined;
  const state = !simulate
    ? { label: "recorded · not executed", tone: "text-fgMuted" }
    : !output
      ? { label: "waiting…", tone: "text-fgMuted" }
      : output.status === "approval_required"
        ? { label: "held at approval gate", tone: "text-warning" }
        : output.status === "error"
          ? { label: "error", tone: "text-destructive" }
          : { label: "simulated", tone: "text-success" };
  return (
    <div className="rounded-lg border border-border bg-bgMuted/50 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
        <Wrench className="h-3.5 w-3.5 text-brandPurple" />
        <span className="font-mono text-xs font-semibold">{part.name}</span>
        {part.approval && <ApprovalBadge level={part.approval} />}
        <span className={`ml-auto font-mono text-[10px] ${state.tone}`}>{state.label}</span>
      </div>
      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
        <div className="p-3">
          <div className="text-[10px] font-mono uppercase tracking-wide text-fgMuted mb-1">arguments</div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all text-fg">{fmtJson(part.input)}</pre>
        </div>
        <div className="p-3">
          <div className="text-[10px] font-mono uppercase tracking-wide text-fgMuted mb-1">result</div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-all text-fgMuted">
            {simulate ? (output ? fmtJson(output) : "…") : "Turn ended at this call (simulation off)."}
          </pre>
        </div>
      </div>
    </div>
  );
}

function AssistantBlock({ turn, models, agentName }: { turn: AssistantTurn; models: PlaygroundModel[]; agentName: string }) {
  const [showReasoning, setShowReasoning] = useState(false);
  const modelLabel = models.find((m) => m.id === turn.model)?.label ?? turn.model;
  const toolCalls = turn.parts.filter((p) => p.kind === "tool").length;
  const reasoning = turn.parts.filter((p) => p.kind === "reasoning").map((p) => (p as { text: string }).text).join("");
  const u = turn.finish?.usage;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 font-mono text-[11px] text-fgMuted">
        <Sparkles className="h-3.5 w-3.5 text-brandBlue" />
        <span className="text-fg font-semibold">{agentName}</span>
        <span>· {modelLabel}</span>
        {turn.status === "streaming" && <span className="text-brandBlue animate-pulse">streaming…</span>}
      </div>

      {reasoning && (
        <button
          onClick={() => setShowReasoning((s) => !s)}
          className="flex items-center gap-1.5 text-[11px] font-mono text-fgMuted hover:text-fg"
        >
          <Brain className="h-3.5 w-3.5" /> {showReasoning ? "hide" : "show"} reasoning summary
        </button>
      )}
      {showReasoning && reasoning && (
        <div className="rounded-md border border-dashed border-border bg-bgMuted/40 p-3 text-xs text-fgMuted whitespace-pre-wrap">{reasoning}</div>
      )}

      {turn.parts.map((p, i) =>
        p.kind === "text" ? (
          <div key={i} className="rounded-lg border border-border bg-bg p-3 text-sm">
            <MarkdownRenderer content={p.text} />
          </div>
        ) : p.kind === "tool" ? (
          <ToolCallCard key={p.id} part={p} simulate={turn.simulate} />
        ) : null,
      )}

      {turn.status === "streaming" && turn.parts.length === 0 && (
        <div className="rounded-lg border border-border bg-bg p-3 text-sm text-fgMuted">Waiting for the first tokens…</div>
      )}
      {turn.status === "error" && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-3 text-sm text-destructive">{turn.error}</div>
      )}
      {turn.status === "stopped" && <div className="text-xs font-mono text-fgMuted">stopped by operator</div>}

      {turn.status !== "streaming" && turn.finish && (
        <div className="flex flex-wrap gap-1.5 font-mono text-[10px]">
          <Badge variant="outline" className="font-mono text-[10px]">{turn.finish.steps} step{turn.finish.steps === 1 ? "" : "s"}</Badge>
          <Badge variant="outline" className="font-mono text-[10px]">{toolCalls} tool call{toolCalls === 1 ? "" : "s"}</Badge>
          {u && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {u.inputTokens ?? "?"} in · {u.outputTokens ?? "?"} out{u.reasoningTokens ? ` · ${u.reasoningTokens} reasoning` : ""}
            </Badge>
          )}
          {turn.durationMs != null && (
            <Badge variant="outline" className="font-mono text-[10px]">{(turn.durationMs / 1000).toFixed(1)}s</Badge>
          )}
          <Badge
            variant="outline"
            className={`font-mono text-[10px] ${turn.finish.finishReason === "tool-calls" ? "text-warning border-warning/50" : ""}`}
          >
            {turn.finish.finishReason === "tool-calls" ? "ended at tool call" : turn.finish.finishReason ?? "done"}
          </Badge>
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function AgentPlayground() {
  const agents = useMemo(() => getDocumentedAgents(), []);
  const [params, setParams] = useSearchParams();
  const settings = useRouterSettings();
  const credential = hasRouterCredential(settings);

  const initialAgent = agents.some((a) => a.id === params.get("agent")) ? params.get("agent")! : "orchestrator";
  const [agentId, setAgentId] = useState(initialAgent);
  const agent = agents.find((a) => a.id === agentId) ?? agents[0];

  const models = useQuery({ queryKey: ["playground-models"], queryFn: fetchPlaygroundModels, staleTime: Infinity, retry: 1 });
  const [modelId, setModelId] = useState<string | null>(null);
  useEffect(() => {
    if (!modelId && models.data?.length) setModelId((models.data.find((m) => m.default) ?? models.data[0]).id);
  }, [models.data, modelId]);
  const model = models.data?.find((m) => m.id === modelId) ?? null;

  const [effort, setEffort] = useState<"low" | "medium" | "high">("low");
  const [simulate, setSimulate] = useState(true);
  const [includeSoul, setIncludeSoul] = useState(true);
  const [includePolicies, setIncludePolicies] = useState(false);
  const [toolNames, setToolNames] = useState<Set<string>>(() => new Set(defaultToolsForAgent(initialAgent)));
  const [useCase, setUseCase] = useState<RoutingUseCase | null>(null);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const selectPersona = (id: string) => {
    setAgentId(id);
    setToolNames(new Set(defaultToolsForAgent(id)));
    setParams((p) => {
      p.set("agent", id);
      return p;
    }, { replace: true });
  };

  const selectedTools: RegistryTool[] = TOOL_REGISTRY.filter((t) => toolNames.has(t.name));
  const instructions = useMemo(
    () => composePersonaPrompt({ agentId, agentName: agent.name, tools: selectedTools, includeSoul, includePolicies, simulateTools: simulate }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [agentId, agent.name, toolNames, includeSoul, includePolicies, simulate],
  );
  const docNamed = useMemo(() => new Set(toolsNamedInAgentDoc(agentId)), [agentId]);
  const categories = useMemo(() => Array.from(new Set(TOOL_REGISTRY.map((t) => t.category))), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const toggleTool = (name: string) =>
    setToolNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy || !model) return;
    const userTurn: UserTurn = { id: uid(), role: "user", content };
    const asst: AssistantTurn = {
      id: uid(),
      role: "assistant",
      persona: agentId,
      model: model.id,
      simulate,
      parts: [],
      status: "streaming",
      startedAt: Date.now(),
    };
    const messages = toMessages([...turns, userTurn]);
    setTurns((t) => [...t, userTurn, asst]);
    setDraft("");
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const update = (fn: (a: AssistantTurn) => AssistantTurn) =>
      setTurns((ts) => ts.map((t) => (t.id === asst.id && t.role === "assistant" ? fn(t) : t)));

    try {
      await streamPlayground(
        settings,
        {
          model: model.id,
          instructions,
          messages,
          tools: selectedTools.map((t) => ({ name: t.name, description: t.description, approval: t.approval, parameters: t.parameters })),
          simulateTools: simulate,
          reasoningEffort: effort,
        },
        (e) => update((a) => applyEvent(a, e)),
        ctrl.signal,
      );
      update((a) => ({ ...a, status: a.status === "streaming" ? "done" : a.status, durationMs: Date.now() - a.startedAt }));
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      update((a) => ({
        ...a,
        status: aborted ? "stopped" : "error",
        error: aborted ? undefined : err instanceof PlaygroundError ? err.message : "Something went wrong sending the prompt.",
        durationMs: Date.now() - a.startedAt,
      }));
      if (!aborted) setDraft((d) => d || content);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const lastUser = [...turns].reverse().find((t): t is UserTurn => t.role === "user");
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  const routingHint = useCase
    ? agentId === "orchestrator"
      ? `Expected routing from base.md: ${useCase.primary}${useCase.support && useCase.support !== "—" ? ` · support: ${useCase.support}` : ""}`
      : useCase.primaryAgentId === agentId
        ? `${agent.name} is the primary agent for “${useCase.taskType}” in base.md.`
        : `base.md routes “${useCase.taskType}” to ${useCase.primary} — testing ${agent.name} off-lane.`
    : null;

  return (
    <div className="max-w-7xl mx-auto space-y-5 text-fg">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link to="/agents" className="text-xs text-fgMuted hover:text-fg font-mono">← agents</Link>
          <h1 className="text-3xl font-bold tracking-tight mt-1">Agent Playground</h1>
          <p className="text-sm text-fgMuted mt-1 max-w-3xl">
            Send a test prompt to a documented persona with a chosen model and tool set. Tool calls are shown as they happen and are never
            really executed — so you can check a persona's behaviour before mapping it to a platform. Powered by Lovable AI.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1.5">
                <FileCode2 className="h-3.5 w-3.5" /> Inspect prompt
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl bg-bg">
              <DialogHeader>
                <DialogTitle>Persona prompt — {agent.name}</DialogTitle>
                <DialogDescription>
                  Composed from the agent model files · {instructions.length.toLocaleString()} characters (≈{Math.round(instructions.length / 4).toLocaleString()} tokens)
                </DialogDescription>
              </DialogHeader>
              <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-bgMuted/50 p-3 text-[11px] font-mono whitespace-pre-wrap">
                {instructions}
              </pre>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="outline" className="gap-1.5" disabled={busy || turns.length === 0} onClick={() => setTurns([])}>
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* ── Configuration ── */}
        <aside className="space-y-5">
          <section className="rounded-xl border border-border bg-bgMuted/40 p-4 space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-wide text-fgMuted">Persona</h2>
            <div className="grid grid-cols-2 gap-2">
              {agents.map((a) => (
                <button
                  key={a.id}
                  onClick={() => selectPersona(a.id)}
                  className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors ${
                    a.id === agentId ? "border-brandBlue bg-bg" : "border-border hover:border-fgMuted"
                  } ${a.id === "orchestrator" ? "col-span-2" : ""}`}
                >
                  {a.avatar && <img src={a.avatar} alt="" className="h-7 w-7 rounded-md object-cover" />}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium truncate">{a.name}</span>
                    {a.id === "orchestrator" && <span className="block text-[10px] font-mono text-fgMuted">coordination layer</span>}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-xs text-fgMuted italic leading-relaxed">{agent.soulSummary}</p>
            <div className="space-y-2 pt-1">
              <label className="flex items-center justify-between gap-2 text-xs">
                <span>Include shared identity (SOUL.md)</span>
                <Switch checked={includeSoul} onCheckedChange={setIncludeSoul} />
              </label>
              <label className="flex items-center justify-between gap-2 text-xs">
                <span>Include policies.md</span>
                <Switch checked={includePolicies} onCheckedChange={setIncludePolicies} />
              </label>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-bgMuted/40 p-4 space-y-3">
            <h2 className="text-xs font-mono uppercase tracking-wide text-fgMuted">Model</h2>
            {models.isError ? (
              <p className="text-xs text-destructive">{(models.error as Error).message}</p>
            ) : (
              <Select value={modelId ?? undefined} onValueChange={setModelId} disabled={!models.data}>
                <SelectTrigger className="bg-bg">
                  <SelectValue placeholder={models.isLoading ? "Loading models…" : "Choose a model"} />
                </SelectTrigger>
                <SelectContent className="bg-bg">
                  {models.data?.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.label}
                      {m.note ? <span className="text-fgMuted"> · {m.note}</span> : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-1">
              <span className="text-xs text-fgMuted mr-auto">Reasoning</span>
              {(["low", "medium", "high"] as const).map((e) => (
                <button
                  key={e}
                  disabled={model?.api !== "responses"}
                  onClick={() => setEffort(e)}
                  className={`rounded border px-2 py-0.5 font-mono text-[11px] disabled:opacity-40 ${
                    effort === e && model?.api === "responses" ? "border-brandBlue text-fg bg-bg" : "border-border text-fgMuted"
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
            {model?.api === "chat" && <p className="text-[11px] text-fgMuted">Reasoning level applies to GPT models only.</p>}
          </section>

          <section className="rounded-xl border border-border bg-bgMuted/40 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono uppercase tracking-wide text-fgMuted">Tools · {toolNames.size}/{TOOL_REGISTRY.length}</h2>
              <div className="flex gap-1 font-mono text-[10px]">
                <button className="text-fgMuted hover:text-fg" onClick={() => setToolNames(new Set(defaultToolsForAgent(agentId)))}>defaults</button>
                <span className="text-fgMuted">·</span>
                <button className="text-fgMuted hover:text-fg" onClick={() => setToolNames(new Set(TOOL_REGISTRY.map((t) => t.name)))}>all</button>
                <span className="text-fgMuted">·</span>
                <button className="text-fgMuted hover:text-fg" onClick={() => setToolNames(new Set())}>none</button>
              </div>
            </div>
            {TOOL_REGISTRY.length === 0 && <p className="text-xs text-warning">No tool definitions found in {TOOL_REGISTRY_SOURCE}.</p>}
            {categories.map((cat) => (
              <div key={cat} className="space-y-1">
                <div className="text-[10px] font-mono uppercase text-fgMuted">{cat}</div>
                {TOOL_REGISTRY.filter((t) => t.category === cat).map((t) => (
                  <label key={t.name} className="flex items-start gap-2 rounded-md px-1 py-1 hover:bg-bg cursor-pointer" title={t.description}>
                    <Checkbox checked={toolNames.has(t.name)} onCheckedChange={() => toggleTool(t.name)} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-xs">{t.name}</span>
                        <ApprovalBadge level={t.approval} />
                        {docNamed.has(t.name) && (
                          <span className="font-mono text-[9px] text-brandPurple" title={`Named in ${agent.name}'s role document`}>doc</span>
                        )}
                      </span>
                      <span className="block text-[11px] text-fgMuted truncate">{t.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
            <p className="text-[10px] text-fgMuted">
              Defaults: every <span className="font-mono">auto</span> tool plus tools named in the agent's own document. Source: {TOOL_REGISTRY_SOURCE}.
            </p>
            <label className="flex items-start justify-between gap-3 border-t border-border pt-3 text-xs">
              <span>
                Simulate tool results
                <span className="block text-[11px] text-fgMuted">
                  {simulate
                    ? "Tools return a placeholder — or an approval gate for approve/critical tools — and the agent continues."
                    : "The turn stops at the first tool call so you see exactly what the agent asked for."}
                </span>
              </span>
              <Switch checked={simulate} onCheckedChange={setSimulate} />
            </label>
          </section>
        </aside>

        {/* ── Conversation ── */}
        <section className="rounded-xl border border-border bg-bg flex flex-col min-h-[560px]">
          {!credential && (
            <div className="flex flex-wrap items-center gap-3 border-b border-border bg-warning/10 px-4 py-3 text-sm">
              <KeyRound className="h-4 w-4 text-warning" />
              <span className="flex-1 min-w-[200px]">Add an Onasis API key in Settings to send prompts — it's checked with the auth gateway before any AI is used.</span>
              <Button asChild size="sm" variant="outline"><Link to="/settings">Open settings</Link></Button>
            </div>
          )}

          <div className="border-b border-border px-4 py-3 space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wide text-fgMuted">Use case · from base.md routing table</div>
            <div className="flex flex-wrap gap-1.5">
              {ROUTING_USE_CASES.map((u) => (
                <button
                  key={u.taskType}
                  onClick={() => {
                    setUseCase(useCase?.taskType === u.taskType ? null : u);
                    inputRef.current?.focus();
                  }}
                  className={`rounded-md border px-2 py-0.5 text-xs transition-colors ${
                    useCase?.taskType === u.taskType ? "border-brandBlue bg-bgMuted text-fg" : "border-border text-fgMuted hover:text-fg"
                  }`}
                >
                  {u.taskType}
                </button>
              ))}
              {ROUTING_USE_CASES.length === 0 && <span className="text-xs text-fgMuted">Routing table not found in base.md.</span>}
            </div>
            {routingHint && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-fgMuted">{routingHint}</span>
                {useCase?.primaryAgentId && useCase.primaryAgentId !== agentId && agentId !== "orchestrator" && (
                  <button className="font-mono text-[11px] text-brandBlue hover:underline" onClick={() => selectPersona(useCase.primaryAgentId!)}>
                    switch to {agentName(useCase.primaryAgentId)}
                  </button>
                )}
              </div>
            )}
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-5 max-h-[calc(100vh-360px)] min-h-[300px]">
            {turns.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2 py-16">
                <Play className="h-6 w-6 text-fgMuted" />
                <div className="text-sm">Write a prompt for {agent.name} and send it.</div>
                <div className="text-xs text-fgMuted max-w-md">
                  Switch persona, model or tools between prompts to compare behaviour — the conversation is kept so you can see each answer side by side.
                </div>
              </div>
            )}
            {turns.map((t) =>
              t.role === "user" ? (
                <div key={t.id} className="flex justify-end">
                  <div className="max-w-[80%] rounded-lg bg-bgMuted px-3 py-2 text-sm whitespace-pre-wrap">{t.content}</div>
                </div>
              ) : (
                <AssistantBlock key={t.id} turn={t} models={models.data ?? []} agentName={agentName(t.persona)} />
              ),
            )}
          </div>

          <div className="border-t border-border p-3 space-y-2">
            <Textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  send(useCase && !draft.startsWith("[") ? `[Task type: ${useCase.taskType}] ${draft}` : draft);
                }
              }}
              placeholder={`Prompt for ${agent.name}…  (Ctrl/⌘ + Enter to send)`}
              rows={3}
              className="bg-bg resize-none"
              disabled={busy}
            />
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-[11px] font-mono text-fgMuted">
                {selectedTools.some((t) => t.approval === "approve" || t.approval === "critical") && (
                  <>
                    <ShieldAlert className="h-3.5 w-3.5 text-warning" /> includes tools that need approval
                  </>
                )}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {lastUser && !busy && (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => send(lastUser.content)} disabled={!credential || !model}>
                    <RotateCcw className="h-3.5 w-3.5" /> Run last prompt again
                  </Button>
                )}
                {busy ? (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => abortRef.current?.abort()}>
                    <CircleStop className="h-3.5 w-3.5" /> Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={!draft.trim() || !credential || !model}
                    onClick={() => send(useCase && !draft.startsWith("[") ? `[Task type: ${useCase.taskType}] ${draft}` : draft)}
                  >
                    <Send className="h-3.5 w-3.5" /> Send
                  </Button>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
