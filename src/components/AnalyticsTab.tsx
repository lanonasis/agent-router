import { useState } from "react";
import { CalendarDays, Filter, Download, BarChart2, TestTube, Heart, MessageSquare, LayoutGrid, ExternalLink, AlertCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AgentType } from "@/types/agent";
import { ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

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

const wordCloudData = [
  { text: "Payment", value: 100, sentiment: "neutral" },
  { text: "Help", value: 85, sentiment: "neutral" },
  { text: "Account", value: 80, sentiment: "neutral" },
  { text: "Bill", value: 70, sentiment: "negative" },
  { text: "Support", value: 65, sentiment: "positive" },
  { text: "Problem", value: 60, sentiment: "negative" },
  { text: "Thanks", value: 55, sentiment: "positive" },
  { text: "Credit", value: 50, sentiment: "neutral" },
  { text: "Update", value: 45, sentiment: "neutral" },
  { text: "Great", value: 40, sentiment: "positive" },
  { text: "Issue", value: 35, sentiment: "negative" },
  { text: "Service", value: 30, sentiment: "neutral" },
  { text: "Excellent", value: 25, sentiment: "positive" },
  { text: "Question", value: 20, sentiment: "neutral" },
];

const channelPerformanceData = [
  { name: "Voice", responseTime: 87, successRate: 92, sentiment: 88 },
  { name: "Chat", responseTime: 95, successRate: 88, sentiment: 92 },
  { name: "Email", responseTime: 75, successRate: 82, sentiment: 80 },
  { name: "Social", responseTime: 80, successRate: 78, sentiment: 85 },
];

const percentFormatter = (value: number) => `${value}%`;
const numberFormatter = (value: number) => value.toLocaleString();

interface AnalyticsTabProps {
  agent: AgentType;
  isNewAgent?: boolean;
}

const AnalyticsTab: React.FC<AnalyticsTabProps> = ({ agent, isNewAgent = false }) => {
  const [dateRange, setDateRange] = useState("30days");
  const [channelFilter, setChannelFilter] = useState("all");

  const latestData = timeSeriesData[timeSeriesData.length - 1];
  const previousData = timeSeriesData[timeSeriesData.length - 2];
  
  const avmChange = ((latestData.avmScore - previousData.avmScore) / previousData.avmScore * 100).toFixed(1);
  const interactionsChange = ((latestData.interactions - previousData.interactions) / previousData.interactions * 100).toFixed(1);
  const callsChange = (((latestData.inboundCalls + latestData.outboundCalls) - 
                      (previousData.inboundCalls + previousData.outboundCalls)) / 
                      (previousData.inboundCalls + previousData.outboundCalls) * 100).toFixed(1);
  const sentimentChange = ((latestData.positivePercent - previousData.positivePercent) / previousData.positivePercent * 100).toFixed(1);
  const coverageChange = ((latestData.testCoverage - previousData.testCoverage) / previousData.testCoverage * 100).toFixed(1);

  const sentimentTimeData = timeSeriesData.map(item => ({
    date: item.date,
    Positive: item.positivePercent,
    Neutral: item.neutralPercent,
    Negative: item.negativePercent,
  }));

  return (
    <div className="max-w-7xl mx-auto animate-in space-y-6">
      {isNewAgent && (
        <Alert className="mb-6 border-agent-primary/30 bg-agent-primary/10">
          <AlertCircle className="h-4 w-4 text-agent-primary" />
          <AlertTitle>New Agent</AlertTitle>
          <AlertDescription>
            This is a newly created agent. Analytics data will be displayed as it becomes available.
          </AlertDescription>
        </Alert>
      )}
      
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-muted-foreground">View your agent's performance metrics and usage statistics.</p>
        </div>
        <Button variant="outline" size="sm" className="flex items-center gap-1">
          <Download className="h-3.5 w-3.5" />
          <span>Export</span>
        </Button>
      </div>
      
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
      
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <BarChart2 className="h-5 w-5 text-agent-primary" />
              Performance Metrics
            </CardTitle>
            <CardDescription>Agent performance and interaction statistics</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <h3 className="text-sm font-medium mb-3">AVM Score Trend</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={timeSeriesData}
                    margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
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
              </div>
            </div>
            
            <div>
              <h3 className="text-sm font-medium mb-3">Call Performance</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart 
                    data={timeSeriesData}
                    margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
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
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="text-sm font-medium mb-3">Test Coverage Trends</h3>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={timeSeriesData}
                  margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
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
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <Heart className="h-5 w-5 text-agent-primary" />
              User Sentiment Analysis
            </CardTitle>
            <CardDescription>How users feel when interacting with the AI agent</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <h3 className="text-sm font-medium mb-3">Sentiment Trend</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={sentimentTimeData}
                    margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
                    stackOffset="expand"
                  >
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value) => value.split('-')[2]} 
                    />
                    <YAxis tickFormatter={(tick) => `${tick * 100}%`} />
                    <CartesianGrid strokeDasharray="3 3" />
                    <Tooltip 
                      formatter={(value: number) => [`${(value * 100).toFixed(1)}%`, '']}
                      labelFormatter={(label) => new Date(label).toLocaleDateString()}
                    />
                    <Legend />
                    <Area 
                      type="monotone" 
                      dataKey="Positive" 
                      stackId="1"
                      stroke="#10b981" 
                      fill="#10b981" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="Neutral" 
                      stackId="1"
                      stroke="#6b7280" 
                      fill="#6b7280" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="Negative" 
                      stackId="1"
                      stroke="#ef4444" 
                      fill="#ef4444" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
            
            <div>
              <h3 className="text-sm font-medium mb-3">Sentiment Breakdown</h3>
              <div className="h-[250px] sm:h-[275px] md:h-[200px] lg:h-[220px]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full w-full">
                  <div className="relative flex items-center justify-center h-full w-full p-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={sentimentData}
                          cx="50%"
                          cy="50%"
                          innerRadius="35%"
                          outerRadius="65%"
                          fill="#8884d8"
                          paddingAngle={2}
                          dataKey="value"
                          label={false}
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
                    <div className="mt-4 text-sm text-muted-foreground">
                      <p><strong>Overall Sentiment:</strong> {latestData.positivePercent}% Positive</p>
                      <p className={`text-xs mt-2 ${Number(sentimentChange) >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        <span>{Number(sentimentChange) >= 0 ? '↑' : '↓'} {Math.abs(Number(sentimentChange))}%</span>
                        <span className="text-muted-foreground ml-1">change since last period</span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-agent-primary" />
              Popular Topics & Conversation Insights
            </CardTitle>
            <CardDescription>Analyze what users are discussing with your agent</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <h3 className="text-sm font-medium mb-3">Topic Distribution</h3>
              <div className="h-[250px] sm:h-[275px] md:h-[200px] lg:h-[220px] flex items-center justify-center">
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                    <Pie
                      data={topicData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      fill="#8884d8"
                      paddingAngle={2}
                      dataKey="value"
                      label={false}
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
            </div>
            
            <div>
              <h3 className="text-sm font-medium mb-3">Topic Trends Over Time</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart
                    data={topicTimeData}
                    margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
                  >
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value) => value.split('-')[2]} 
                    />
                    <YAxis />
                    <CartesianGrid strokeDasharray="3 3" />
                    <Tooltip 
                      formatter={(value: number) => [`${value}%`, '']}
                      labelFormatter={(label) => new Date(label).toLocaleDateString()}
                    />
                    <Legend />
                    <Area 
                      type="monotone" 
                      dataKey="Issue Resolution" 
                      stackId="1"
                      stroke="#3b82f6" 
                      fill="#3b82f6" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="Billing Questions" 
                      stackId="1"
                      stroke="#8b5cf6" 
                      fill="#8b5cf6" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="Technical Support" 
                      stackId="1"
                      stroke="#ec4899" 
                      fill="#ec4899" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="text-sm font-medium mb-3">Common Keywords & Phrases</h3>
            <div className="p-4 bg-secondary/30 rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-center gap-4">
                {wordCloudData.map((word, index) => {
                  const size = 14 + (word.value / 10);
                  
                  let color;
                  if (word.sentiment === "positive") color = "text-green-500";
                  else if (word.sentiment === "negative") color = "text-red-500";
                  else color = "text-gray-500";
                  
                  return (
                    <div key={index} className="group relative">
                      <span 
                        className={`${color} font-medium cursor-help transition-all duration-200 hover:scale-110`} 
                        style={{ fontSize: `${size}px` }}
                      >
                        {word.text}
                      </span>
                      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-secondary-foreground text-secondary text-xs rounded-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none whitespace-nowrap">
                        <strong>Frequency:</strong> {word.value}
                        <div className="text-[10px] capitalize">
                          <strong>Sentiment:</strong> {word.sentiment}
                        </div>
                        <div className="absolute bottom-0 left-1/2 transform -translate-x-1/2 translate-y-1/2 border-[5px] border-transparent border-t-secondary-foreground"></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
      
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg font-bold flex items-center gap-2">
              <LayoutGrid className="h-5 w-5 text-agent-primary" />
              Channel Performance
            </CardTitle>
            <CardDescription>Performance analysis across different communication channels</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div>
              <h3 className="text-sm font-medium mb-3">Distribution by Channel</h3>
              <div className="h-[400px] sm:h-[450px] md:h-[350px] lg:h-[400px]">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full w-full">
                  <div className="relative flex items-center justify-center h-full w-full p-4">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={channelData}
                          cx="50%"
                          cy="50%"
                          innerRadius="35%"
                          outerRadius="65%"
                          fill="#8884d8"
                          paddingAngle={2}
                          dataKey="value"
                          label={false}
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
              </div>
            </div>
            
            <div>
              <h3 className="text-sm font-medium mb-3">Channel Usage Trends</h3>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={timeSeriesData}
                    margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      dataKey="date" 
                      tickFormatter={(value) => value.split('-')[2]} 
                    />
                    <YAxis />
                    <Tooltip
                      formatter={(value: number) => [value, 'Interactions']}
                      labelFormatter={(label) => new Date(label).toLocaleDateString()}
                    />
                    <Legend />
                    <Line 
                      type="monotone" 
                      dataKey="Voice" 
                      stroke="#3b82f6" 
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 5 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="Chat" 
                      stroke="#8b5cf6" 
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 5 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="Email" 
                      stroke="#ec4899" 
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 5 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="Social" 
                      stroke="#10b981" 
                      strokeWidth={2}
                      dot={{ r: 2 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="text-sm font-medium mb-3">Performance Comparison by Channel</h3>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={channelPerformanceData}
                  margin={{ top: 10, right: 0, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis domain={[0, 100]} />
                  <Tooltip formatter={percentFormatter} />
                  <Legend />
                  <Bar 
                    dataKey="responseTime" 
                    name="Response Time" 
                    fill="#3b82f6" 
                  />
                  <Bar 
                    dataKey="successRate" 
                    name="Success Rate" 
                    fill="#8b5cf6" 
                  />
                  <Bar 
                    dataKey="sentiment" 
                    name="Positive Sentiment" 
                    fill="#10b981" 
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AnalyticsTab;
