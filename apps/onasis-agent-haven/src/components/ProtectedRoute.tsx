import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

/**
 * Route guard. Authentication state comes from AuthContext, which restores
 * either the stored access token or the gateway's session cookie on mount.
 * Do not read localStorage here — a valid cookie-only session has no token.
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { isLoggedIn, isInitializing } = useAuth();
  const location = useLocation();

  if (isInitializing) {
    return (
      <div className="min-h-screen w-full bg-[#0a0a0a] flex items-center justify-center font-mono text-sm text-[#888]">
        checking session…
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
