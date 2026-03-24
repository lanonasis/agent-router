import { Link } from "react-router-dom";
import { ArrowLeft, PlusCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const AgentCreate = () => {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <Link to="/agents" className="inline-flex items-center text-fgMuted hover:text-fg transition-colors text-sm">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Agent System
        </Link>
      </div>

      <h1 className="text-2xl font-bold text-fg mb-2">Define New Agent</h1>
      <p className="text-sm text-fgMuted mb-8">
        New agents are defined by adding a markdown file to <code className="text-xs bg-bgMuted px-1.5 py-0.5 rounded border border-border">docs/agent_model_files/</code> and registering it in the agent source map.
      </p>

      <Card>
        <CardContent className="py-12 flex flex-col items-center text-center">
          <div className="h-12 w-12 rounded-full bg-brandPurple/10 flex items-center justify-center mb-4">
            <PlusCircle className="h-6 w-6 text-brandPurple" />
          </div>
          <h2 className="text-lg font-semibold text-fg mb-2">Doc-Driven Agent Creation</h2>
          <p className="text-sm text-fgMuted max-w-md">
            Agents in this system are defined by their canonical documentation files. To create a new agent, add its RISEN prompt and identity to the docs directory, then register it in the source map.
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default AgentCreate;
