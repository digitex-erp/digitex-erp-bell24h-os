import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PerformanceIntelligenceService, PerformanceMetric, Recommendation, LearningInsight } from "@/modules/performance/PerformanceIntelligenceService";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TrendingUp, Target, Users, BarChart3, BrainCircuit, Sparkles, Check } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function PerformanceDashboardPage() {
  const [metrics, setMetrics] = useState<PerformanceMetric | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [insights, setInsights] = useState<LearningInsight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const service = PerformanceIntelligenceService.getInstance();
        const [m, r, i] = await Promise.all([
          service.getExecutiveMetrics(),
          service.getRecommendations(),
          service.getLearningInsights()
        ]);
        setMetrics(m);
        setRecommendations(r);
        setInsights(i);
      } catch (error) {
        console.error("Failed to fetch performance data:", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const handleApplyRecommendation = async (id: string) => {
    try {
      await PerformanceIntelligenceService.getInstance().applyRecommendation(id);
      setRecommendations(prev => prev.map(r => r.id === id ? { ...r, status: 'applied' } : r));
    } catch (error) {
      console.error("Failed to apply recommendation:", error);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Performance Intelligence</h1>
          <p className="text-muted-foreground">Autonomous optimization and learning engine for Bell24h-OS</p>
        </div>
        <div className="flex space-x-2">
            <Button variant="outline">
                <BarChart3 className="mr-2 h-4 w-4" /> Export Report
            </Button>
            <Button>
                <BrainCircuit className="mr-2 h-4 w-4" /> Run Learning Cycle
            </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total ROI</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.roi ? `${metrics.roi}x` : '0.0x'}</div>
            <p className="text-xs text-muted-foreground">+12.5% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Conversions</CardTitle>
            <Target className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.conversions?.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground">+4.2% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Reach</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.reach?.toLocaleString() || 0}</div>
            <p className="text-xs text-muted-foreground">+18% from last month</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg. CTR</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics?.ctr ? `${metrics.ctr}%` : '0.0%'}</div>
            <p className="text-xs text-muted-foreground">+0.8% from last month</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="recommendations" className="space-y-6">
        <TabsList>
          <TabsTrigger value="recommendations">AI Recommendations</TabsTrigger>
          <TabsTrigger value="learning">Learning Engine</TabsTrigger>
          <TabsTrigger value="experiments">A/B Experiments</TabsTrigger>
        </TabsList>

        <TabsContent value="recommendations" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              {recommendations.filter(r => r.status === 'pending').map((rec) => (
                <Card key={rec.id}>
                  <CardContent className="pt-6">
                    <div className="flex justify-between items-start">
                      <div className="space-y-1">
                        <div className="flex items-center space-x-2">
                          <Sparkles className="h-4 w-4 text-amber-500" />
                          <h3 className="font-bold">{rec.title}</h3>
                          <Badge variant="secondary">{rec.category}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{rec.description}</p>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="text-right">
                          <p className="text-xs font-medium text-muted-foreground">Confidence</p>
                          <p className="text-sm font-bold">{Math.round(rec.confidence_score * 100)}%</p>
                        </div>
                        <Button size="sm" onClick={() => handleApplyRecommendation(rec.id)}>Apply</Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {recommendations.filter(r => r.status === 'pending').length === 0 && !loading && (
                <Card className="border-dashed flex flex-col items-center justify-center p-12">
                   <Check className="h-12 w-12 text-green-500 mb-4" />
                   <h3 className="font-bold">System Optimized</h3>
                   <p className="text-sm text-muted-foreground">No pending recommendations found.</p>
                </Card>
              )}
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Optimization Health</CardTitle>
                    <CardDescription>System self-improvement score</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span>Creative Quality</span>
                            <span>92%</span>
                        </div>
                        <Progress value={92} />
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span>Audience Accuracy</span>
                            <span>78%</span>
                        </div>
                        <Progress value={78} />
                    </div>
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span>Publishing Timing</span>
                            <span>88%</span>
                        </div>
                        <Progress value={88} />
                    </div>
                </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="learning">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {insights.map((insight) => (
                    <Card key={insight.id}>
                        <CardHeader>
                            <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">
                                {insight.model_type.replace('_', ' ')}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <pre className="text-xs bg-muted p-4 rounded-md overflow-auto max-h-48">
                                {JSON.stringify(insight.insights, null, 2)}
                            </pre>
                            <p className="text-[10px] text-muted-foreground mt-4">
                                Last Trained: {new Date(insight.last_trained_at).toLocaleString()}
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </TabsContent>

        <TabsContent value="experiments">
            <Card className="border-dashed p-12 flex flex-col items-center justify-center">
                <BrainCircuit className="h-12 w-12 text-primary mb-4" />
                <h3 className="font-bold text-xl">Experimentation Engine</h3>
                <p className="text-muted-foreground mb-6">Launch autonomous A/B tests to discover winner assets.</p>
                <Button>Start New Experiment</Button>
            </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
