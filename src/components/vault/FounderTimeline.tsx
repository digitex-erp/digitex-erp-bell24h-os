
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  Circle, 
  Clock, 
  Flag, 
  MapPin, 
  TrendingUp, 
  Globe,
  Building2,
  Lock,
  Search,
  Loader2,
  AlertTriangle
} from "lucide-react";
import { authedFetchJson, AuthedFetchError } from "@/lib/authedFetch";

interface Milestone {
  id: string;
  title: string;
  description: string;
  status: 'Completed' | 'Current' | 'Future';
  sort_order: number;
}

const ICON_MAP: Record<string, any> = {
  "Business Idea": Flag,
  "Research": MapPin,
  "Supplier Discovery": Search,
  "Wine Shop Survey": Clock,
  "Prototype": Circle,
  "First Order": Circle,
  "First Repeat Order": Circle,
  "Monthly Break-even": Circle,
  "VyaparSethu Funding": TrendingUp,
  "Expansion": Globe,
  "Hotels": Building2,
  "White Label": Lock,
  "Premium Ice": Lock,
  "Luxury Diamond Ice": Lock,
  "Export": Lock,
  "Manufacturing Plant": Lock,
  "Multiple Cities": Lock,
  "International Expansion": Lock,
};

export function FounderTimeline() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetchJson<Milestone[]>("/api/vault/timeline")
      .then(data => {
        setMilestones(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch timeline:", err);
        setError(
          err instanceof AuthedFetchError && err.status === 401
            ? "Your session could not be verified — try signing in again."
            : "Could not load the roadmap.",
        );
        setMilestones([]);
        setLoading(false);
      });
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Founder Roadmap</CardTitle>
        <p className="text-sm text-muted-foreground">The strategic trajectory of ICECRAFT from inception to global dominance.</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground font-bold uppercase tracking-widest">Loading Roadmap...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-4">
            <AlertTriangle className="h-10 w-10 text-destructive" />
            <p className="text-sm text-destructive font-medium">{error}</p>
          </div>
        ) : (
          <div className="relative space-y-0 pb-8">
            {/* Vertical Line */}
            <div className="absolute left-[21px] top-4 bottom-0 w-0.5 bg-border" />

            <div className="space-y-8">
              {milestones.map((item, idx) => {
                const Icon = ICON_MAP[item.title] || Circle;
                return (
                  <div key={item.id} className="relative flex items-center gap-6">
                    <div className={`z-10 flex h-11 w-11 items-center justify-center rounded-full border-4 bg-background ${
                      item.status === 'Completed' ? 'border-green-500 text-green-500' : 
                      item.status === 'Current' ? 'border-primary text-primary animate-pulse' : 
                      'border-muted text-muted-foreground'
                    }`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    
                    <div className="flex-1 flex items-center justify-between">
                      <div className="space-y-1">
                        <p className={`font-bold ${item.status === 'Future' ? 'text-muted-foreground' : 'text-foreground'}`}>
                          {item.title}
                        </p>
                        <p className="text-[10px] uppercase font-bold tracking-tighter text-muted-foreground/60">
                          Step {item.sort_order}
                        </p>
                      </div>
                      <Badge 
                        variant={item.status === 'Completed' ? 'default' : (item.status === 'Current' ? 'outline' : 'secondary')}
                        className={`text-[9px] font-black uppercase ${item.status === 'Completed' ? 'bg-green-500' : ''}`}
                      >
                        {item.status}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
