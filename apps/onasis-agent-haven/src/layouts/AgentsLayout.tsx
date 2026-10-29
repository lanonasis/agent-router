import { NavLink, Outlet } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAuth } from "@/contexts/AuthContext";
import { useRouterHeartbeat, STATUS_BG } from "@/hooks/useRouterHeartbeat";

const AgentsLayout: React.FC = () => {
  const { logout, user, isDevBypass } = useAuth();
  const { data: heartbeat } = useRouterHeartbeat();
  const routerStatus = heartbeat?.routerStatus ?? "warn";

  return (
    <div className="min-h-screen w-full bg-[#0a0a0a]">
      {/* Top bar with logout */}
      <header className="border-b border-[#333] bg-[#1a1a1a] px-4 py-2 flex items-center justify-between">
        <div className="text-[#00ff00] font-mono text-sm">
          <span className="text-[#888]">$</span>{" "}
          <span className="text-[#fff]">lanonasis</span>{" "}
          <span className="text-[#00ff00]">platform</span>
          {user?.email && (
            <span className="ml-4 text-[#888] text-xs">
              [{user.email}]
            </span>
          )}
          {isDevBypass && (
            <span
              className="ml-2 text-[10px] text-[#ffbd2e] border border-[#ffbd2e] rounded px-1.5 py-0.5"
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
          ].map((l) => (
            <NavLink key={l.to} to={l.to} className={({ isActive }) => `px-2 py-1 rounded ${isActive ? "text-[#fff] bg-[#2a2a2a]" : "text-[#888] hover:text-[#fff]"}`}>
              {l.label}
            </NavLink>
          ))}
          <NavLink
            to="/chain"
            className={({ isActive }) =>
              `flex items-center gap-1.5 px-3 py-1 rounded border transition-colors ${isActive ? "border-[#00ff00] text-[#00ff00] bg-[#00ff00]/10" : "border-[#444] text-[#ddd] hover:border-[#00ff00] hover:text-[#00ff00]"}`
            }
          >
            <span className="relative flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full rounded-full opacity-70 animate-ping ${STATUS_BG[routerStatus]}`} />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${STATUS_BG[routerStatus]}`} />
            </span>
            Router Chain & Topology
          </NavLink>
        </nav>
        <button
          onClick={logout}
          className="text-xs font-mono text-[#888] hover:text-[#ff5f56] hover:border-[#ff5f56] border border-[#333] hover:border-[#ff5f56] rounded px-2 py-1 transition-all duration-200"
          title="Disconnect session"
        >
          EXIT ▸
        </button>
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