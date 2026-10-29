import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "@/hooks/useTheme";
import { AuthProvider } from "@/contexts/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AgentsLayout from "./layouts/AgentsLayout";
import AgentsDashboard from "./pages/AgentsDashboard";
import AgentDetails from "./pages/AgentDetails";
import AgentCreate from "./pages/AgentCreate";
import ChainWiring from "./pages/ChainWiring";
import DocsBrowser from "./pages/DocsBrowser";
import RouterActivity from "./pages/RouterActivity";
import RouterSettings from "./pages/RouterSettings";
import AgentPlayground from "./pages/AgentPlayground";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: any) => {
        // Don't retry if we get a 404 for new123 agent
        if (error?.message?.includes("Agent with id new123 not found")) {
          return false;
        }
        return failureCount < 3;
      }
    }
  }
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="system">
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              {/* Public login page — not protected */}
              <Route path="/login" element={<Login />} />

              {/* Redirect root → agents (requires auth) */}
              <Route path="/" element={<ProtectedRoute><Navigate to="/agents" replace /></ProtectedRoute>} />

              {/* Protected routes */}
              <Route path="/agents" element={
                <ProtectedRoute>
                  <AgentsLayout />
                </ProtectedRoute>
              }>
                <Route index element={<AgentsDashboard />} />
                <Route path="create" element={<AgentCreate />} />
                <Route path=":agentId" element={<AgentDetails />} />
              </Route>

              <Route path="/docs" element={
                <ProtectedRoute>
                  <AgentsLayout />
                </ProtectedRoute>
              }>
                <Route index element={<DocsBrowser />} />
              </Route>

              <Route path="/chain" element={
                <ProtectedRoute>
                  <ChainWiring />
                </ProtectedRoute>
              } />

              <Route element={
                <ProtectedRoute>
                  <AgentsLayout />
                </ProtectedRoute>
              }>
                <Route path="/activity" element={<RouterActivity />} />
                <Route path="/settings" element={<RouterSettings />} />
                <Route path="/playground" element={<AgentPlayground />} />
              </Route>

              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;