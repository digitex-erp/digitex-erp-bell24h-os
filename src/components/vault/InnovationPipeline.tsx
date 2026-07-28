
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Lightbulb, 
  Search, 
  FlaskConical, 
  Package, 
  Rocket,
  ArrowRight,
  TrendingUp,
  Workflow
} from "lucide-react";

const PIPELINE_STAGES = [
  { id: 'idea', name: 'Idea', icon: Lightbulb, color: 'text-amber-500' },
  { id: 'research', name: 'Research', icon: Search, color: 'text-blue-500' },
  { id: 'prototype', name: 'Prototype', icon: FlaskConical, color: 'text-purple-500' },
  { id: 'validation', name: 'Validation', icon: Package, color: 'text-green-500' },
  { id: 'market', name: 'Market', icon: Rocket, color: 'text-primary' }
];

const INNOVATIONS = [
  {
    title: "Eco-Friendly Insulated Paper Cup",
    stage: 'prototype',
    priority: 'High',
    desc: "Biodegradable alternative to plastic cups with 2-hour ice retention."
  },
  {
    title: "Sub-Zero Delivery Notification Engine",
    stage: 'validation',
    priority: 'Critical',
    desc: "Real-time SMS/App alerts if container temp rises above -12°C."
  },
  {
    title: "Premium Round Brilliant Ice",
    stage: 'market',
    priority: 'Standard',
    desc: "57-facet luxury ice sphere for high-end bars."
  },
  {
    title: "Ice-as-a-Subscription (IaaS)",
    stage: 'idea',
    priority: 'Medium',
    desc: "Monthly recurring revenue model for residential luxury ice delivery."
  }
];

export function InnovationPipeline() {
  return (
    <div className="space-y-8">
      {/* Pipeline Visualizer */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {PIPELINE_STAGES.map((stage, idx) => (
          <div key={stage.id} className="relative group">
            <Card className="text-center border-dashed group-hover:border-primary/50 transition-colors">
              <CardContent className="pt-6">
                <div className={`mx-auto h-10 w-10 flex items-center justify-center rounded-full bg-muted/50 mb-3 ${stage.color}`}>
                  <stage.icon className="h-5 w-5" />
                </div>
                <p className="text-[10px] font-black uppercase tracking-widest">{stage.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {INNOVATIONS.filter(i => i.stage === stage.id).length} Items
                </p>
              </CardContent>
            </Card>
            {idx < PIPELINE_STAGES.length - 1 && (
              <div className="hidden md:block absolute -right-4 top-1/2 -translate-y-1/2 z-10">
                <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {INNOVATIONS.map((item, idx) => (
          <Card key={idx} className="flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start mb-2">
                <Badge variant={item.priority === 'Critical' ? 'destructive' : (item.priority === 'High' ? 'default' : 'secondary')} className="text-[9px] font-bold uppercase">
                  {item.priority}
                </Badge>
                <div className="flex items-center gap-1 text-[10px] font-bold text-muted-foreground uppercase">
                  <Workflow className="h-3 w-3" />
                  {item.stage}
                </div>
              </div>
              <CardTitle className="text-lg font-bold leading-tight">{item.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 space-y-4">
              <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
              <div className="pt-4 border-t mt-auto flex justify-between items-center">
                <div className="flex items-center gap-1 text-[10px] font-bold text-primary">
                  <TrendingUp className="h-3 w-3" /> ROI: High
                </div>
                <Button variant="ghost" size="sm" className="h-8 text-[10px] font-bold uppercase tracking-widest p-0 px-2">
                  Advance Stage
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
