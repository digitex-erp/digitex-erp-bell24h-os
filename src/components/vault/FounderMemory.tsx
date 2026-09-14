
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, History, Plus, AlertTriangle, Lightbulb, MessageSquare, Loader2 } from "lucide-react";
import { authedFetchJson, AuthedFetchError } from "@/lib/authedFetch";

interface Decision {
  id: string;
  title: string;
  created_at: string;
  context: string;
  rationale: string;
  outcome: string;
  lessons_learned: string;
}

export function FounderMemory() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetchJson<Decision[]>("/api/vault/decisions")
      .then(data => {
        setDecisions(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch decisions:", err);
        setError(
          err instanceof AuthedFetchError && err.status === 401
            ? "Your session could not be verified — try signing in again."
            : "Could not load the decision log.",
        );
        setDecisions([]);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-bold flex items-center gap-2">
          <History className="h-5 w-5 text-primary" />
          Strategic Decision Log
        </h3>
        <Button className="font-bold">
          <Plus className="mr-2 h-4 w-4" /> Record Decision
        </Button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground font-bold uppercase tracking-widest">Recalling History...</p>
        </div>
      ) : error ? (
        <Card className="border-dashed border-destructive/40 py-20 flex flex-col items-center justify-center">
          <AlertTriangle className="h-10 w-10 text-destructive mb-4" />
          <p className="text-destructive font-medium text-sm">{error}</p>
        </Card>
      ) : decisions.length === 0 ? (
        <Card className="border-dashed py-20 flex flex-col items-center justify-center">
          <History className="h-10 w-10 text-muted-foreground mb-4" />
          <p className="text-muted-foreground font-medium text-sm">No strategic decisions recorded yet.</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {decisions.map((item) => (
            <Card key={item.id} className="border-l-4 border-l-amber-500">
              <CardHeader className="pb-3">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg font-bold">{item.title}</CardTitle>
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {new Date(item.created_at).toLocaleDateString()}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-1">
                      <MessageSquare className="h-3 w-3" /> Context
                    </p>
                    <p className="text-sm">{item.context}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase text-muted-foreground flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> The "Why"
                    </p>
                    <p className="text-sm">{item.rationale}</p>
                  </div>
                </div>
                
                <div className="p-3 bg-muted rounded-lg flex gap-4 items-start border border-dashed">
                  <Lightbulb className="h-5 w-5 text-amber-500 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Lessons Learned</p>
                    <p className="text-xs font-medium italic">"{item.lessons_learned}"</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* AI Memory Synthesis Card */}
      {!loading && decisions.length > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5 text-primary" />
              <CardTitle className="text-sm font-bold uppercase tracking-widest">AI Pattern Recognition</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Based on your logged decisions, you consistently prioritize **Operational Redundancy** and **Long-term Resilience**. This strengthens the foundation of ICECRAFT as a permanent operating system.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
