import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IndustryIntelligenceService } from "@/modules/industry-intelligence/IndustryIntelligenceService";

export function IndustryDashboardPage() {
  const [industries, setIndustries] = useState<any[]>([]);

  useEffect(() => {
    IndustryIntelligenceService.getInstance().getIndustries().then(setIndustries);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Industry Intelligence Dashboard</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {industries.map(industry => (
          <Card key={industry.id}>
            <CardHeader><CardTitle>{industry.name}</CardTitle></CardHeader>
            <CardContent><p>{industry.description}</p></CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
