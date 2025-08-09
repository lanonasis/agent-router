
import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Bot, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center max-w-md px-6 py-16 animate-fade-in">
        <div className="bg-agent-primary/10 p-4 rounded-full w-20 h-20 mx-auto mb-6 flex items-center justify-center">
          <Bot className="h-10 w-10 text-agent-primary" />
        </div>
        <h1 className="text-6xl font-bold text-agent-dark mb-4">404</h1>
        <p className="text-xl text-gray-600 mb-6">
          Oops! This page doesn't exist or has been moved.
        </p>
        <p className="text-gray-500 mb-8">
          The page you are looking for might have been removed, had its name changed,
          or is temporarily unavailable.
        </p>
        <Button asChild className="bg-agent-primary hover:bg-agent-primary/90">
          <Link to="/agents" className="inline-flex items-center space-x-2">
            <Home className="h-4 w-4" />
            <span>Return to Dashboard</span>
          </Link>
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
