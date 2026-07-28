
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  BookOpen, 
  Library, 
  History, 
  Lock, 
  Brain, 
  Lightbulb, 
  ArrowRight,
  Database,
  Shield,
  Target
} from "lucide-react";
import { VaultDocuments } from "@/components/vault/VaultDocuments";
import { RdLibrary } from "@/components/vault/RdLibrary";
import { FounderTimeline } from "@/components/vault/FounderTimeline";
import { PhaseUnlockEngine } from "@/components/vault/PhaseUnlockEngine";
import { FounderMemory } from "@/components/vault/FounderMemory";
import { InnovationPipeline } from "@/components/vault/InnovationPipeline";

import { Button } from "@/components/ui/button";

export function KnowledgeVaultPage() {
  const [activeTab, setActiveTab] = useState("vault");

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col space-y-2">
        <h1 className="text-4xl font-black tracking-tight flex items-center gap-3">
          <Database className="h-8 w-8 text-primary" />
          Founder Knowledge Vault
        </h1>
        <p className="text-muted-foreground text-lg">
          The permanent strategic memory and operational intelligence center of ICECASH OS.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="border-b overflow-x-auto">
          <TabsList className="bg-transparent h-12 w-full justify-start space-x-4">
            <TabsTrigger 
              value="vault" 
              className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary border-b-2 border-transparent data-[state=active]:border-primary rounded-none h-12 px-4"
            >
              <BookOpen className="h-4 w-4 mr-2" />
              Core Vault
            </TabsTrigger>
            <TabsTrigger 
              value="rd" 
              className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary border-b-2 border-transparent data-[state=active]:border-primary rounded-none h-12 px-4"
            >
              <Library className="h-4 w-4 mr-2" />
              R&D Library
            </TabsTrigger>
            <TabsTrigger 
              value="timeline" 
              className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary border-b-2 border-transparent data-[state=active]:border-primary rounded-none h-12 px-4"
            >
              <History className="h-4 w-4 mr-2" />
              Founder Timeline
            </TabsTrigger>
            <TabsTrigger 
              value="phases" 
              className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary border-b-2 border-transparent data-[state=active]:border-primary rounded-none h-12 px-4"
            >
              <Lock className="h-4 w-4 mr-2" />
              Phase Unlock
            </TabsTrigger>
            <TabsTrigger 
              value="memory" 
              className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary border-b-2 border-transparent data-[state=active]:border-primary rounded-none h-12 px-4"
            >
              <Brain className="h-4 w-4 mr-2" />
              Founder Memory
            </TabsTrigger>
            <TabsTrigger 
              value="innovation" 
              className="data-[state=active]:bg-primary/10 data-[state=active]:text-primary border-b-2 border-transparent data-[state=active]:border-primary rounded-none h-12 px-4"
            >
              <Lightbulb className="h-4 w-4 mr-2" />
              Innovation Pipeline
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="mt-6">
          <TabsContent value="vault">
            <VaultDocuments />
          </TabsContent>
          <TabsContent value="rd">
            <RdLibrary />
          </TabsContent>
          <TabsContent value="timeline">
            <FounderTimeline />
          </TabsContent>
          <TabsContent value="phases">
            <PhaseUnlockEngine />
          </TabsContent>
          <TabsContent value="memory">
            <FounderMemory />
          </TabsContent>
          <TabsContent value="innovation">
            <InnovationPipeline />
          </TabsContent>
        </div>
      </Tabs>

      {/* AI Founder Mentor Floating Quick Access */}
      <AiMentorComponent />
    </div>
  );
}

function AiMentorComponent() {
  const [advice, setAdvice] = useState("Finalize Supplier Discovery. Highest ROI activity is verifying FSSAI compliance for primary manufacturer.");
  const [loading, setLoading] = useState(false);

  const consultMentor = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/vault/mentor-advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPhase: "Phase 0: Foundation",
          focus: "Supplier Verification"
        })
      });
      const data = await res.json();
      if (data.advice) setAdvice(data.advice);
    } catch (err) {
      console.error("Mentor consultation failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed bottom-8 right-8 z-50">
      <Card className="w-80 shadow-2xl border-primary/20 bg-card/95 backdrop-blur">
        <CardHeader className="p-4 bg-primary text-primary-foreground rounded-t-lg">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Brain className="h-5 w-5" />
              <CardTitle className="text-sm font-bold">AI Founder Mentor</CardTitle>
            </div>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-3">
          <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest border-b pb-1">
            Today's Focus: Phase 0 Completion
          </div>
          <div className="space-y-2">
            <p className="text-sm font-bold">What should I do today?</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {advice}
            </p>
          </div>
          <div className="pt-2">
            <Button 
              size="sm" 
              className="w-full text-[11px] font-bold uppercase tracking-tighter h-8"
              onClick={consultMentor}
              disabled={loading}
            >
              Consult Mentor <ArrowRight className="ml-2 h-3 w-3" />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

import { Loader2 } from "lucide-react";
