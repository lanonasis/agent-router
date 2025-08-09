
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, CalendarDays, Filter, Download, BarChart2, TestTube, Heart, MessageSquare, LayoutGrid } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAgentDetails } from "@/hooks/useAgentDetails";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

// Sample data for charts
const timeSeriesData = Array.from({ length: 30 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - i);
  
  return {
    date: date.toISOString().split('T')[0],
    avmScore: Math.floor(Math.random() * 3) + 7,
    interactions: Math.floor(Math.random() * 20) + 10,
    positivePercent: Math.floor(Math.random() * 30) + 60,
    neutralPercent: Math.floor(Math.random() * 20) + 10,
    negativePercent: Math.floor(Math.random() * 10) + 1,
    inboundCalls: Math.floor(Math.random() * 10) + 5,
    outboundCalls: Math.floor(Math.random() * 8) + 2,
    testCoverage: Math.min(100, Math.floor(Math.random() * 5) + 75 + i/4),
    Voice: Math.floor(Math.random() * 15) + 10,
    Chat: Math.floor(Math.random() * 20) + 15,
    Email: Math.floor(Math.random() * 10) + 5,
    Social: Math.floor(Math.random() * 8) + 2,
  };
}).reverse();

const channelData = [
  { name: "Voice", value: 40, color: "#3b82f6" },
  { name: "Chat", value: 30, color: "#8b5cf6" },
  { name: "Email", value: 20, color: "#ec4899" },
  { name: "Social", value: 10, color: "#10b981" },
];

const sentimentData = [
  { name: "Positive", value: 70, color: "#10b981" },
  { name: "Neutral", value: 25, color: "#6b7280" },
  { name: "Negative", value: 5, color: "#ef4444" },
];

const callChannelData = [
  { name: "VoIP", value: 45, color: "#60a5fa" },
  { name: "Mobile", value: 40, color: "#a78bfa" },
  { name: "Landline", value: 15, color: "#fb7185" },
];

const topicData = [
  { name: "Issue Resolution", value: 35, color: "#3b82f6" },
  { name: "Billing Questions", value: 25, color: "#8b5cf6" },
  { name: "Technical Support", value: 20, color: "#ec4899" },
  { name: "General Inquiry", value: 15, color: "#10b981" },
  { name: "Other", value: 5, color: "#6b7280" },
];

const topicTimeData = timeSeriesData.map(item => {
  return {
    date: item.date,
    "Issue Resolution": Math.floor(Math.random() * 15) + 25,
    "Billing Questions": Math.floor(Math.random() * 10) + 20,
    "Technical Support": Math.floor(Math.random() * 10) + 15,
  };
});

const channelPerformanceData = [
  { name: "Voice", responseTime: 87, successRate: 92, sentiment: 88 },
  { name: "Chat", responseTime: 95, successRate: 88, sentiment: 92 },
  { name: "Email", responseTime: 75, successRate: 82, sentiment: 80 },
  { name: "Social", responseTime: 80, successRate: 78, sentiment: 85 },
];

// Custom formatter for tooltips
const percentFormatter = (value: number) => `${value}%`;
const numberFormatter = (value: number) => value.toLocaleString();
const timeFormatter = (value: number) => `${value}s`;

const AgentAnalytics = () => {
  const { agentId } = useParams<{ agentId: string }>();
  const { agent, isLoading, error } = useAgentDetails(agentId);
  const [dateRange, setDateRange] = useState("30days");
  const [channelFilter, setChannelFilter] = useState("all");
  const [currentTab, setCurrentTab] = useState("performance");

  console.log("AgentAnalytics - Current agentId:", agentId);

  if (isLoading) {
    return <div className="flex justify-center items-center h-[80vh]">
      <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full"></div>
    </div>;
  }

  if (error || !agent) {
    return <div className="max-w-4xl mx-auto">
      <div className="mb-8">
        <Link to="/agents" className="flex items-center text-gray-500 hover:text-primary">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Agents
        </Link>
      </div>
      
      <div className="bg-destructive/10 text-destructive p-4 rounded-md">
        <p className="font-medium">Error loading agent analytics</p>
        <p className="text-sm mt-1">{error || "Agent not found"}</p>
      </div>
    </div>;
  }

  // Calculate latest metrics and changes
  const latestData = timeSeriesData[timeSeriesData.length - 1];
  const previousData = timeSeriesData[timeSeriesData.length - 2];
  
  const avmChange = ((latestData.avmScore - previousData.avmScore) / previousData.avmScore * 100).toFixed(1);
  const interactionsChange = ((latestData.interactions - previousData.interactions) / previousData.interactions * 100).toFixed(1);
  const callsChange = (((latestData.inboundCalls + latestData.outboundCalls) - 
                      (previousData.inboundCalls + previousData.outboundCalls)) / 
                      (previousData.inboundCalls + previousData.outboundCalls) * 100).toFixed(1);
  const sentimentChange = ((latestData.positivePercent - previousData.positivePercent) / previousData.positivePercent * 100).toFixed(1);
  const coverageChange = ((latestData.testCoverage - previousData.testCoverage) / previousData.testCoverage * 100).toFixed(1);

  return (
    <div className="max-w-7xl mx-auto animate-in">
      <div className="mb-6">
        <Link to={`/agents/${agentId}`} className="flex items-center text-gray-500 hover:text-primary transition-colors duration-200">
          <ArrowLeft className="h-4 w-4 mr-2" />
          <span className="text-sm font-medium">Back to Agent Details</span>
        </Link>
      </div>
      
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Avatar className="h-12 w-12 border-2 border-primary/30">
            <AvatarImage src={`https://api.dicebear.com/7.x/bottts/svg?seed=${agent.id}`} alt={agent.name} />
            <AvatarFallback className="bg-primary/20">{agent.name.substring(0, 2)}</AvatarFallback>
          </Avatar>
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              {agent.name}
              <Badge variant="outline" className="ml-2 text-xs">Analytics</Badge>
            </h1>
            <p className="text-muted-foreground">{agent.description}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 self-end md:self-auto">
          <Button variant="outline" size="sm" className="flex items-center gap-1">
            <Download className="h-3.5 w-3.5" />
            <span>Export</span>
          </Button>
        </div>
      </div>
      
      {/* Global controls */}
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <Select value={dateRange} onValueChange={setDateRange}>
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Select date range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="7days">Last 7 Days</SelectItem>
                    <SelectItem value="30days">Last 30 Days</SelectItem>
                    <SelectItem value="custom">Custom Range</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex items-center gap-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <Select value={channelFilter} onValueChange={setChannelFilter}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue placeholder="Select channel" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Channels</SelectItem>
                    <SelectItem value="voice">Voice</SelectItem>
                    <SelectItem value="chat">Chat</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="social">Social</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">AVM Score</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="flex flex-col">
              <div className="text-2xl font-bold">{latestData.avmScore.toFixed(1)}/10</div>
              <div className={`text-xs flex items-center mt-1 ${Number(avmChange) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                <span>{Number(avmChange) >= 0 ? '↑' : '↓'} {Math.abs(Number(avmChange))}%</span>
                <span className="text-muted-foreground ml-1">vs previous</span>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Interactions</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="flex flex-col">
              <div className="text-2xl font-bold">{latestData.interactions}</div>
              <div className={`text-xs flex items-center mt-1 ${Number(interactionsChange) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                <span>{Number(interactionsChange) >= 0 ? '↑' : '↓'} {Math.abs(Number(interactionsChange))}%</span>
                <span className="text-muted-foreground ml-1">vs previous</span>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Calls</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="flex flex-col">
              <div className="text-2xl font-bold">{latestData.inboundCalls + latestData.outboundCalls}</div>
              <div className={`text-xs flex items-center mt-1 ${Number(callsChange) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                <span>{Number(callsChange) >= 0 ? '↑' : '↓'} {Math.abs(Number(callsChange))}%</span>
                <span className="text-muted-foreground ml-1">vs previous</span>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">User Sentiment</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="flex flex-col">
              <div className="text-2xl font-bold">{latestData.positivePercent}%</div>
              <div className={`text-xs flex items-center mt-1 ${Number(sentimentChange) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                <span>{Number(sentimentChange) >= 0 ? '↑' : '↓'} {Math.abs(Number(sentimentChange))}%</span>
                <span className="text-muted-foreground ml-1">positive</span>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="p-4 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Testing Coverage</CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-2">
            <div className="flex flex-col">
              <div className="text-2xl font-bold">{latestData.testCoverage.toFixed(1)}%</div>
              <div className={`text-xs flex items-center mt-1 ${Number(coverageChange) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                <span>{Number(coverageChange) >= 0 ? '↑' : '↓'} {Math.abs(Number(coverageChange))}%</span>
                <span className="text-muted-foreground ml-1">complete</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Tabbed Analytics Interface */}
      <Tabs defaultValue="performance" value={currentTab} onValueChange={setCurrentTab} className="space-y-4">
        <TabsList className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <TabsTrigger value="performance" className="gap-2">
            <BarChart2 className="h-4 w-4" />
            <span>Performance</span>
          </TabsTrigger>
          <TabsTrigger value="testing" className="gap-2">
            <TestTube className="h-4 w-4" />
            <span>Testing</span>
          </TabsTrigger>
          <TabsTrigger value="sentiment" className="gap-2">
            <Heart className="h-4 w-4" />
            <span>Sentiment</span>
          </TabsTrigger>
          <TabsTrigger value="topics" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            <span>Topics</span>
          </TabsTrigger>
          <TabsTrigger value="channels" className="gap-2">
            <LayoutGrid className="h-4 w-4" />
            <span>Channels</span>
          </TabsTrigger>
        </TabsList>
        
        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="col-span-1">
              <CardHeader>
                <CardTitle>AVM Score Trend</CardTitle>
                <CardDescription>
                  Agent Versatility Metric score over time
                </CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={timeSeriesData}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="avmScore" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value) => value.split('-')[2]} 
                    />
                    <YAxis domain={[0, 10]} />
                    <CartesianGrid strokeDasharray="3 3" />
                    <Tooltip 
                      formatter={(value: number) => [value.toFixed(1), 'AVM Score']}
                      labelFormatter={(label) => new Date(label).toLocaleDateString()}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="avmScore" 
                      stroke="#3b82f6" 
                      fillOpacity={1} 
                      fill="url(#avmScore)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            
            <Card className="col-span-1">
              <CardHeader>
                <CardTitle>Interactions Breakdown</CardTitle>
                <CardDescription>
                  Total interactions per channel
                </CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
                  <div className="flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={channelData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          fill="#8884d8"
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {channelData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => [`${value}%`, 'Percentage']} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col justify-center">
                    {channelData.map((item, index) => (
                      <div key={index} className="flex items-center mb-2">
                        <div style={{ backgroundColor: item.color }} className="w-3 h-3 mr-2 rounded-full"></div>
                        <span className="text-sm">{item.name}: {item.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          <Card>
            <CardHeader>
              <CardTitle>Call Performance</CardTitle>
              <CardDescription>
                Inbound vs Outbound Calls over time
              </CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart 
                  data={timeSeriesData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value) => value.split('-')[2]} 
                  />
                  <YAxis />
                  <Tooltip
                    formatter={(value: number) => [value, 'Calls']}
                    labelFormatter={(label) => new Date(label).toLocaleDateString()}
                  />
                  <Legend />
                  <Bar dataKey="inboundCalls" name="Inbound" stackId="a" fill="#3b82f6" />
                  <Bar dataKey="outboundCalls" name="Outbound" stackId="a" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Testing Tab */}
        <TabsContent value="testing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Test Coverage Trends</CardTitle>
              <CardDescription>
                Testing coverage percentage over time
              </CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={timeSeriesData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value) => value.split('-')[2]} 
                  />
                  <YAxis domain={[0, 100]} />
                  <Tooltip
                    formatter={percentFormatter}
                    labelFormatter={(label) => new Date(label).toLocaleDateString()}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="testCoverage" 
                    name="Test Coverage" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Test Case Execution</CardTitle>
              </CardHeader>
              <CardContent className="h-80">
                <div className="font-medium text-center text-muted-foreground h-full flex items-center justify-center">
                  Test case execution data visualization coming soon
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Coverage by Feature</CardTitle>
              </CardHeader>
              <CardContent className="h-80">
                <div className="font-medium text-center text-muted-foreground h-full flex items-center justify-center">
                  Feature coverage heatmap coming soon
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        {/* Sentiment Tab */}
        <TabsContent value="sentiment" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Sentiment Breakdown</CardTitle>
                <CardDescription>
                  Distribution of user sentiment
                </CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
                  <div className="flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={sentimentData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          fill="#8884d8"
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {sentimentData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => [`${value}%`, 'Percentage']} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col justify-center">
                    {sentimentData.map((item, index) => (
                      <div key={index} className="flex items-center mb-2">
                        <div style={{ backgroundColor: item.color }} className="w-3 h-3 mr-2 rounded-full"></div>
                        <span className="text-sm">{item.name}: {item.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Sentiment Over Time</CardTitle>
                <CardDescription>
                  Sentiment trends over the selected period
                </CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={timeSeriesData}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="positiveGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="neutralGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6b7280" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#6b7280" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="negativeGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value) => value.split('-')[2]} 
                    />
                    <YAxis />
                    <CartesianGrid strokeDasharray="3 3" />
                    <Tooltip 
                      formatter={percentFormatter}
                      labelFormatter={(label) => new Date(label).toLocaleDateString()}
                    />
                    <Legend />
                    <Area 
                      type="monotone" 
                      dataKey="positivePercent" 
                      name="Positive" 
                      stroke="#10b981" 
                      fillOpacity={1} 
                      fill="url(#positiveGradient)" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="neutralPercent" 
                      name="Neutral" 
                      stroke="#6b7280" 
                      fillOpacity={1} 
                      fill="url(#neutralGradient)" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="negativePercent" 
                      name="Negative" 
                      stroke="#ef4444" 
                      fillOpacity={1} 
                      fill="url(#negativeGradient)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        {/* Topics Tab */}
        <TabsContent value="topics" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Top Topics</CardTitle>
                <CardDescription>
                  Most frequent conversation topics
                </CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full">
                  <div className="flex items-center justify-center">
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie
                          data={topicData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          fill="#8884d8"
                          paddingAngle={2}
                          dataKey="value"
                          label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                          labelLine={false}
                        >
                          {topicData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value) => [`${value}%`, 'Percentage']} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col justify-center">
                    {topicData.map((item, index) => (
                      <div key={index} className="flex items-center mb-2">
                        <div style={{ backgroundColor: item.color }} className="w-3 h-3 mr-2 rounded-full"></div>
                        <span className="text-sm">{item.name}: {item.value}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader>
                <CardTitle>Topic Trends</CardTitle>
                <CardDescription>
                  Topic distribution over time
                </CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart 
                    data={topicTimeData}
                    margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                  >
                    <defs>
                      <linearGradient id="issueGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="billingGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="technicalGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ec4899" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#ec4899" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value) => value.split('-')[2]} 
                    />
                    <YAxis />
                    <CartesianGrid strokeDasharray="3 3" />
                    <Tooltip 
                      formatter={percentFormatter}
                      labelFormatter={(label) => new Date(label).toLocaleDateString()}
                    />
                    <Legend />
                    <Area 
                      type="monotone" 
                      dataKey="Issue Resolution" 
                      stroke="#3b82f6" 
                      fillOpacity={1} 
                      fill="url(#issueGradient)" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="Billing Questions" 
                      stroke="#8b5cf6" 
                      fillOpacity={1} 
                      fill="url(#billingGradient)" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="Technical Support" 
                      stroke="#ec4899" 
                      fillOpacity={1} 
                      fill="url(#technicalGradient)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
          
          <Card>
            <CardHeader>
              <CardTitle>Conversation Keywords</CardTitle>
              <CardDescription>
                Most common words and phrases used
              </CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              <div className="font-medium text-center text-muted-foreground h-full flex items-center justify-center">
                Word cloud visualization coming soon
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Channels Tab */}
        <TabsContent value="channels" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Channel Performance Comparison</CardTitle>
              <CardDescription>
                Response time, success rate and sentiment per channel
              </CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={channelPerformanceData}
                  layout="vertical"
                  margin={{ top: 20, right: 30, left: 60, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" domain={[0, 100]} />
                  <YAxis dataKey="name" type="category" width={80} />
                  <Tooltip formatter={percentFormatter} />
                  <Legend />
                  <Bar dataKey="responseTime" name="Response Time" fill="#3b82f6" />
                  <Bar dataKey="successRate" name="Success Rate" fill="#10b981" />
                  <Bar dataKey="sentiment" name="Sentiment" fill="#8b5cf6" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader>
              <CardTitle>Channel Effectiveness Over Time</CardTitle>
              <CardDescription>
                Performance trends per channel
              </CardDescription>
            </CardHeader>
            <CardContent className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={timeSeriesData}
                  margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis 
                    dataKey="date" 
                    tickFormatter={(value) => value.split('-')[2]} 
                  />
                  <YAxis />
                  <Tooltip
                    formatter={numberFormatter}
                    labelFormatter={(label) => new Date(label).toLocaleDateString()}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="Voice" 
                    stroke="#3b82f6" 
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="Chat" 
                    stroke="#8b5cf6" 
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="Email" 
                    stroke="#ec4899" 
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="Social" 
                    stroke="#10b981" 
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default AgentAnalytics;
