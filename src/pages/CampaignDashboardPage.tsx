import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignManagerService, Campaign } from "@/modules/campaign-manager/CampaignManagerService";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";

export function CampaignDashboardPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);

  useEffect(() => {
    CampaignManagerService.getInstance().getCampaigns().then(setCampaigns);
  }, []);

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">Campaign Manager</h1>
        <Button asChild>
          <Link to="/campaigns/builder">Create Campaign</Link>
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle>Active Campaigns</CardTitle></CardHeader>
          <CardContent>
            {campaigns.filter(c => c.status === 'active').length}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Planned Campaigns</CardTitle></CardHeader>
          <CardContent>
            {campaigns.filter(c => c.status === 'planned').length}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
