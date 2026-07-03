import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignManagerService } from "@/modules/campaign-manager/CampaignManagerService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useNavigate } from "react-router-dom";

export function CampaignBuilderPage() {
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const navigate = useNavigate();

  const handleCreate = async () => {
    await CampaignManagerService.getInstance().createCampaign({ name, objective, status: 'planned' });
    navigate("/campaigns");
  };

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Create New Campaign</h1>
      <Card>
        <CardHeader><CardTitle>Campaign Details</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Input placeholder="Campaign Name" value={name} onChange={e => setName(e.target.value)} />
          <Input placeholder="Objective" value={objective} onChange={e => setObjective(e.target.value)} />
          <Button onClick={handleCreate}>Create Campaign</Button>
        </CardContent>
      </Card>
    </div>
  );
}
