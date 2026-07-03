import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeoIntelligenceService } from "@/modules/seo-intelligence/SeoIntelligenceService";

export function SeoDashboardPage() {
  const [projects, setProjects] = useState<any[]>([]);

  useEffect(() => {
    SeoIntelligenceService.getInstance().getProjects().then(setProjects);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">SEO Intelligence Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>SEO Projects</CardTitle></CardHeader>
          <CardContent>
            {projects.length === 0 ? <p>No projects found.</p> : (
                <ul>
                    {projects.map(p => <li key={p.id}>{p.name}</li>)}
                </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
