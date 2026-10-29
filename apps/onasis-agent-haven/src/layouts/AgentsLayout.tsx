import { NavLink, Outlet } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useRouterHeartbeat, STATUS_BG } from "@/hooks/useRouterHeartbeat";
import { ThemeToggle } from "@/components/ThemeToggle";

const AgentsLayout: React.FC = () => {
  const { logout, user, isDevBypass } = useAuth();
  const { data: heartbeat } = useRouterHeartbeat();
  const routerStatus = heartbeat?.routerStatus ?? "warn";

  return (
    <div className="min-h-screen w-full bg-bg text-fg">
      {/* Top bar with logout */}
      <header className="border-b border-border bg-bgMuted px-4 py-2 flex items-center justify-between gap-3">
        <div className="font-mono text-sm">
          <span className="text-fgMuted">$</span>{" "}
          <span className="text-fg">lanonasis</span>{" "}
          <span className="text-success">platform</span>
          {user?.email && (
            <span className="ml-4 text-fgMuted text-xs">
              [{user.email}]
            </span>
          )}
          {isDevBypass && (
            <span
              className="ml-2 text-[10px] text-warning border border-warning rounded px-1.5 py-0.5"
              title="Authentication is bypassed in dev mode. EXIT returns to the real login."
            >
              DEV BYPASS
            </span>
          )}
        </div>
        <nav className="flex items-center gap-1 font-mono text-xs">
          {[
            { to: "/agents", label: "agents" },
            { to: "/docs", label: "docs" },
            { to: "/playground", label: "playground" },
            { to: "/activity", label: "activity" },
            { to: "/settings", label: "settings" },
          ].map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => `px-2 py-1 rounded ${isActive ? "text-fg bg-bg" : "text-fgMuted hover:text-fg"}`}>
              {l.label}
            </NavLink>
          ))}
          <NavLink
            to="/chain"
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 py-1 rounded border transition-colors ${isActive ? "border-success text-success bg-success/10" : "border-border text-fg hover:border-success hover:text-success"}`
            }
          >
            <span className="relative flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-70 animate-ping ${STATUS_BG[routerStatus]}`} />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${STATUS_BG[routerStatus]}`} />
            </span>
            Router Chain & Topology
          </NavLink>
        </nav>
        <div className="flex items-center gap-2">
        <ThemeToggle />
        <button
          onClick={logout}
          className="text-xs font-mono text-fgMuted border border-border hover:text-destructive hover:border-destructive rounded px-2 py-1 transition-all duration-200"
          title="Disconnect session"
        >
          EXIT ▸
        </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        <TooltipProvider>
          <div className="h-full overflow-y-auto p-6 animate-fade-in">
            <Outlet />
          </div>
        </TooltipProvider>
      </main>
    </div>
  );
};

export default AgentsLayout;