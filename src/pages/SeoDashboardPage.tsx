import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeoIntelligenceService } from "@/modules/seo-intelligence/SeoIntelligenceService";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export function SeoDashboardPage() {
  const [opportunities, setOpportunities] = useState<any[]>([]);

  useEffect(() => {
    SeoIntelligenceService.getInstance().getOpportunities('default-project-id').then(setOpportunities);
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">SEO Intelligence Dashboard</h1>
      <Card>
        <CardHeader><CardTitle>Market Opportunities</CardTitle></CardHeader>
        <CardContent>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>Keyword</TableHead>
                        <TableHead>Search Intent</TableHead>
                        <TableHead>Opportunity Score</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {opportunities.map(opp => (
                        <TableRow key={opp.id}>
                            <TableCell>{opp.keyword}</TableCell>
                            <TableCell>{opp.intent}</TableCell>
                            <TableCell>{opp.opportunityScore.toFixed(2)}</TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </CardContent>
      </Card>
    </div>
  );
}
