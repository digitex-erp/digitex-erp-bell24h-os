import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { AIManagerService } from "@/modules/ai-providers/AiProviderService";
import { JobOrchestratorService } from "@/modules/job-orchestrator/JobOrchestratorService";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, RefreshCw, FileText, CheckCircle2, XCircle, Clock, PlayCircle } from "lucide-react";

const CONTENT_TYPES = [
  "Title", "Blog Outline", "LinkedIn Post", "Twitter/X Thread", 
  "Facebook Post", "Instagram Caption", "YouTube Short Script", 
  "Voice Script", "Image Prompt", "Video Prompt", 
  "Thumbnail Prompt", "Hashtags", "CTA"
];

export function ContentPlannerPage() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  
  // Create Project State
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectForm, setProjectForm] = useState({
    name: "", brand: "", language: "English", industry: "", 
    target_audience: "", country: "", tone: "Professional", content_goal: ""
  });

  // Topics
  const [topics, setTopics] = useState<any[]>([]);
  const [newTopic, setNewTopic] = useState("");
  
  // Jobs
  const [jobs, setJobs] = useState<any[]>([]);
  const [outputs, setOutputs] = useState<any[]>([]);
  
  // Queue Processor State
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    fetchProjects();
  }, [user]);

  useEffect(() => {
    if (selectedProject) {
      fetchTopicsAndJobs(selectedProject.id);
    }
  }, [selectedProject]);

  async function fetchProjects() {
    if (!user) return;
    setLoading(true);
    try {
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      if (profile?.organization_id) {
        const { data } = await supabase.from('content_projects')
          .select('*')
          .eq('organization_id', profile.organization_id)
          .order('created_at', { ascending: false });
        if (data) {
          setProjects(data);
          if (data.length > 0 && !selectedProject) {
            setSelectedProject(data[0]);
          }
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchTopicsAndJobs(projectId: string) {
    try {
      const { data: tData } = await supabase.from('content_topics')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (tData) setTopics(tData);

      const topicIds = tData?.map(t => t.id) || [];
      if (topicIds.length > 0) {
        const { data: jData } = await supabase.from('content_jobs')
          .select('*')
          .in('topic_id', topicIds)
          .order('created_at', { ascending: false });
        if (jData) setJobs(jData);

        const { data: oData } = await supabase.from('content_outputs')
          .select('*')
          .in('topic_id', topicIds)
          .order('created_at', { ascending: false });
        if (oData) setOutputs(oData);
      } else {
        setJobs([]);
        setOutputs([]);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    try {
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      if (profile?.organization_id) {
        const { data, error } = await supabase.from('content_projects').insert({
          ...projectForm,
          organization_id: profile.organization_id,
          created_by: user.id
        }).select().single();
        
        if (error) throw error;
        
        await fetchProjects();
        setCreateProjectOpen(false);
        if (data) setSelectedProject(data);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleAddTopic(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !selectedProject || !newTopic.trim()) return;
    
    try {
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      if (profile?.organization_id) {
        const { data: topic, error } = await supabase.from('content_topics').insert({
          project_id: selectedProject.id,
          topic: newTopic,
          source: 'manual',
          status: 'pending',
          organization_id: profile.organization_id
        }).select().single();
        
        if (error) throw error;
        setNewTopic("");
        
        // Create 13 jobs for this topic
        const jobsToInsert = CONTENT_TYPES.map(type => ({
          topic_id: topic.id,
          content_type: type,
          status: 'queued',
          organization_id: profile.organization_id
        }));
        
        const { data: insertedJobs } = await supabase.from('content_jobs').insert(jobsToInsert).select();
        
        if (insertedJobs) {
            for (const job of insertedJobs) {
                await JobOrchestratorService.getInstance().enqueueJob(
                    profile.organization_id,
                    'content',
                    { 
                        topic: newTopic, 
                        contentType: job.content_type, 
                        projectId: selectedProject.id,
                        content_job_id: job.id
                    },
                    'medium'
                );
            }
        }
        
        fetchTopicsAndJobs(selectedProject.id);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function getOrCreateTemplate(orgId: string, contentType: string) {
    const templateTitle = `Content Planner: ${contentType}`;
    const { data: existing } = await supabase.from('prompt_templates')
      .select('*')
      .eq('organization_id', orgId)
      .eq('title', templateTitle)
      .single();
      
    if (existing) return existing;
    
    // Create new template
    const systemPrompt = "You are an expert enterprise content marketer and copywriter.";
    const userPrompt = `Project Context:\nBrand: {{brand}}\nIndustry: {{industry}}\nTarget Audience: {{target_audience}}\nLanguage: {{language}}\nTone: {{tone}}\nGoal: {{content_goal}}\n\nTopic: {{topic}}\n\nTask: Generate a highly engaging, professional ${contentType} based on the above topic and context. Output only the requested content, no conversational filler.`;
    
    const { data: newTemplate, error } = await supabase.from('prompt_templates').insert({
      title: templateTitle,
      description: `Auto-generated template for Content Planner ${contentType}`,
      category: "Content Planner",
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      organization_id: orgId,
      created_by: user!.id,
      temperature: 0.7,
      max_tokens: 1500
    }).select().single();
    
    if (error) {
      console.error("Failed to create template", error);
      throw error;
    }
    return newTemplate;
  }

  
  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'completed': return <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20"><CheckCircle2 className="w-3 h-3 mr-1"/> Completed</Badge>;
      case 'running': return <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20"><Loader2 className="w-3 h-3 mr-1 animate-spin"/> Running</Badge>;
      case 'failed': return <Badge className="bg-red-500/10 text-red-500 border-red-500/20"><XCircle className="w-3 h-3 mr-1"/> Failed</Badge>;
      default: return <Badge variant="outline" className="text-muted-foreground"><Clock className="w-3 h-3 mr-1"/> Queued</Badge>;
    }
  };

  const queuedCount = jobs.filter(j => j.status === 'queued').length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Content Planner</h1>
          <p className="text-muted-foreground">
            Orchestrate mass content generation across all platforms.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setCreateProjectOpen(true)} variant="outline">
            <Plus className="mr-2 h-4 w-4" /> New Project
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="md:col-span-1 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Projects</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loading ? (
                <div className="p-4 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
              ) : projects.length === 0 ? (
                <div className="p-4 text-center text-muted-foreground text-sm">No projects found.</div>
              ) : (
                <div className="flex flex-col">
                  {projects.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedProject(p)}
                      className={`text-left px-4 py-3 text-sm transition-colors hover:bg-muted/50 ${selectedProject?.id === p.id ? 'bg-muted border-l-2 border-primary font-medium' : ''}`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {selectedProject && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Project Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div><span className="text-muted-foreground">Brand:</span> {selectedProject.brand}</div>
                <div><span className="text-muted-foreground">Industry:</span> {selectedProject.industry}</div>
                <div><span className="text-muted-foreground">Tone:</span> {selectedProject.tone}</div>
                <div><span className="text-muted-foreground">Goal:</span> {selectedProject.content_goal}</div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="md:col-span-3">
          {selectedProject ? (
            <Tabs defaultValue="topics" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="topics">Topics & Queue</TabsTrigger>
                <TabsTrigger value="outputs">Generated Outputs</TabsTrigger>
              </TabsList>
              
              <TabsContent value="topics" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Topic Generator</CardTitle>
                    <CardDescription>Add topics to automatically queue 13 content generation jobs per topic.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={handleAddTopic} className="flex gap-2">
                      <Input 
                        placeholder="e.g. 10 Benefits of AI in Healthcare" 
                        value={newTopic}
                        onChange={e => setNewTopic(e.target.value)}
                        className="flex-1"
                      />
                      <Button type="submit" disabled={!newTopic.trim()}>Generate Content</Button>
                    </form>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Job Queue</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Topic</TableHead>
                            <TableHead>Content Type</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right">Time</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {jobs.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                                No jobs queued.
                              </TableCell>
                            </TableRow>
                          ) : (
                            jobs.map(job => (
                              <TableRow key={job.id}>
                                <TableCell className="font-medium max-w-[200px] truncate">
                                  {topics.find(t => t.id === job.topic_id)?.topic || 'Unknown'}
                                </TableCell>
                                <TableCell>{job.content_type}</TableCell>
                                <TableCell>{getStatusBadge(job.status)}</TableCell>
                                <TableCell className="text-right text-xs text-muted-foreground">
                                  {new Date(job.created_at).toLocaleTimeString()}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="outputs" className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  {outputs.length === 0 ? (
                    <div className="col-span-full py-12 text-center border rounded-xl border-dashed">
                      <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium">No Outputs Yet</h3>
                      <p className="text-muted-foreground mb-4 mt-1">Start the queue to generate content.</p>
                    </div>
                  ) : (
                    outputs.map(output => (
                      <Card key={output.id} className="flex flex-col h-[300px]">
                        <CardHeader className="pb-2">
                          <div className="flex justify-between items-start">
                            <Badge variant="outline">{output.content_type}</Badge>
                            <span className="text-xs text-muted-foreground">{new Date(output.created_at).toLocaleDateString()}</span>
                          </div>
                          <CardTitle className="text-sm mt-2 line-clamp-2">
                            {topics.find(t => t.id === output.topic_id)?.topic}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="flex-1 overflow-y-auto">
                          <div className="p-3 bg-muted/30 rounded-md text-xs whitespace-pre-wrap font-mono">
                            {output.content}
                          </div>
                        </CardContent>
                      </Card>
                    ))
                  )}
                </div>
              </TabsContent>
            </Tabs>
          ) : (
            <div className="py-24 text-center border rounded-xl border-dashed">
              <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">Select a Project</h3>
              <p className="text-muted-foreground mb-4 mt-1">Choose a project from the sidebar or create a new one to get started.</p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
        <DialogContent className="max-w-2xl">
          <form onSubmit={handleCreateProject}>
            <DialogHeader>
              <DialogTitle>Create Content Project</DialogTitle>
              <DialogDescription>Define the brand context for your AI generations.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label>Project Name</Label>
                <Input required value={projectForm.name} onChange={e => setProjectForm({...projectForm, name: e.target.value})} placeholder="e.g. Q3 SaaS Marketing" />
              </div>
              <div className="space-y-2">
                <Label>Brand Name</Label>
                <Input required value={projectForm.brand} onChange={e => setProjectForm({...projectForm, brand: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Industry</Label>
                <Input required value={projectForm.industry} onChange={e => setProjectForm({...projectForm, industry: e.target.value})} placeholder="e.g. Healthcare Tech" />
              </div>
              <div className="space-y-2">
                <Label>Target Audience</Label>
                <Input required value={projectForm.target_audience} onChange={e => setProjectForm({...projectForm, target_audience: e.target.value})} placeholder="e.g. Hospital Administrators" />
              </div>
              <div className="space-y-2">
                <Label>Language</Label>
                <Input required value={projectForm.language} onChange={e => setProjectForm({...projectForm, language: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Tone of Voice</Label>
                <Input required value={projectForm.tone} onChange={e => setProjectForm({...projectForm, tone: e.target.value})} placeholder="e.g. Professional, Authoritative" />
              </div>
              <div className="col-span-2 space-y-2">
                <Label>Content Goal</Label>
                <Textarea required value={projectForm.content_goal} onChange={e => setProjectForm({...projectForm, content_goal: e.target.value})} placeholder="e.g. Drive webinar signups and establish thought leadership." />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateProjectOpen(false)}>Cancel</Button>
              <Button type="submit">Create Project</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
