import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AutomationService } from "@/modules/automation/AutomationService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Save, Zap, Settings, Play, Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AutomationBuilderPage() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [trigger, setTrigger] = useState("schedule");
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const handleSave = async () => {
    if (!name) return;
    setSaving(true);
    try {
      await AutomationService.getInstance().createWorkflow({
        name,
        description,
        status: 'draft'
      });
      navigate("/automation");
    } catch (error) {
      console.error("Failed to save workflow:", error);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/automation")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-2xl font-bold">Workflow Builder</h1>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" /> Save Draft
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Zap className="mr-2 h-4 w-4" /> Publish Workflow
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">General Info</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase text-muted-foreground">Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily Campaign Gen" />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase text-muted-foreground">Description</label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Auto-generates assets..." />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Trigger Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase text-muted-foreground">Type</label>
                <Select value={trigger} onValueChange={setTrigger}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="schedule">Schedule (Cron)</SelectItem>
                    <SelectItem value="event">System Event</SelectItem>
                    <SelectItem value="seo">SEO Opportunity</SelectItem>
                    <SelectItem value="webhook">Webhook</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-3">
          <Card className="h-[600px] bg-slate-50/50 border-dashed relative overflow-hidden flex flex-col items-center justify-center">
             <div className="absolute top-4 left-4 p-2 bg-white rounded-md shadow-sm border flex items-center space-x-2">
                <Settings className="h-4 w-4 text-muted-foreground" />
                <span className="text-xs font-medium">Visual Node Editor v1.0</span>
             </div>

             <div className="space-y-8 flex flex-col items-center scale-110">
                <div className="w-48 p-4 bg-white rounded-lg border-2 border-primary shadow-lg flex flex-col items-center space-y-2">
                   <div className="p-2 bg-primary/10 rounded-full">
                      <Zap className="h-6 w-6 text-primary" />
                   </div>
                   <span className="font-bold text-sm">Trigger: {trigger}</span>
                </div>

                <div className="h-8 w-0.5 bg-border relative">
                   <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 border-4 border-transparent border-t-border" />
                </div>

                <div className="w-56 p-4 bg-white rounded-lg border border-dashed flex flex-col items-center space-y-2 opacity-60">
                   <Plus className="h-6 w-6 text-muted-foreground" />
                   <span className="text-sm text-muted-foreground">Add Action or Condition</span>
                </div>
             </div>

             <div className="absolute bottom-8 text-center text-muted-foreground max-w-md">
                <p className="text-xs">
                  Bell24h Autonomous Workflow Engine will automatically resolve variables and state between steps using the Global Job Orchestrator.
                </p>
             </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
