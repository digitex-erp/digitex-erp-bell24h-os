
import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Lock, Unlock, CheckCircle, Circle, AlertCircle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { authedFetchJson, AuthedFetchError } from "@/lib/authedFetch";

interface Phase {
  id: number;
  title: string;
  description: string;
  status: 'Unlocked' | 'Locked';
  progress: number;
  conditions: { text: string; met: boolean }[];
}

export function PhaseUnlockEngine() {
  const [phases, setPhases] = useState<Phase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authedFetchJson<Phase[]>("/api/vault/phases")
      .then(data => {
        setPhases(data);
        setLoading(false);
      })
      .catch(err => {
        console.error("Failed to fetch phases:", err);
        setError(
          err instanceof AuthedFetchError && err.status === 401
            ? "Your session could not be verified — try signing in again."
            : "Could not load phases.",
        );
        setPhases([]);
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-6">
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 flex gap-4 items-start">
        <AlertCircle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-200">Phase Unlock Logic Active</p>
          <p className="text-xs text-amber-800/70 dark:text-amber-200/60 leading-relaxed">
            Future modules and dashboards remain locked until specific milestones are achieved. This ensures natural business evolution without overwhelming the founder.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground font-bold uppercase tracking-widest">Calculating Evolution...</p>
        </div>
      ) : error ? (
        <Card className="border-dashed border-destructive/40 py-20 flex flex-col items-center justify-center">
          <AlertCircle className="h-10 w-10 text-destructive mb-4" />
          <p className="text-destructive font-medium text-sm">{error}</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          {phases.map((phase) => (
            <Card key={phase.id} className={phase.status === 'Locked' ? 'opacity-75' : 'border-primary/50'}>
              <CardHeader className="pb-4">
                <div className="flex justify-between items-start">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      {phase.status === 'Unlocked' ? (
                        <Unlock className="h-4 w-4 text-green-500" />
                      ) : (
                        <Lock className="h-4 w-4 text-muted-foreground" />
                      )}
                      <CardTitle className="text-xl font-bold">{phase.title}</CardTitle>
                    </div>
                    <CardDescription>{phase.description}</CardDescription>
                  </div>
                  <Badge variant={phase.status === 'Unlocked' ? 'default' : 'secondary'} className="uppercase text-[10px] font-black">
                    {phase.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    <span>Phase Progress</span>
                    <span>{phase.progress}%</span>
                  </div>
                  <Progress value={phase.progress} className="h-2" />
                </div>

                <div className="space-y-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Unlock Conditions</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {phase.conditions?.map((cond, idx) => (
                      <div key={idx} className={`flex items-center gap-3 p-3 rounded-lg border text-xs font-medium ${
                        cond.met ? 'bg-green-500/5 border-green-500/20 text-green-700' : 'bg-muted/50 border-transparent text-muted-foreground'
                      }`}>
                        {cond.met ? (
                          <CheckCircle className="h-4 w-4 shrink-0" />
                        ) : (
                          <Circle className="h-4 w-4 shrink-0" />
                        )}
                        {cond.text}
                      </div>
                    ))}
                  </div>
                </div>

                {phase.status === 'Locked' && phase.progress >= 90 && (
                  <div className="pt-4">
                    <Button className="w-full font-bold uppercase tracking-widest">
                      Unlock Phase {phase.id}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
