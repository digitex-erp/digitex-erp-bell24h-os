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
import { Switch } from "@/components/ui/switch";
import { Loader2, Plus, RefreshCw, Image as ImageIcon, CheckCircle2, XCircle, Clock, PlayCircle, Download, Trash, Copy } from "lucide-react";

const IMAGE_CATEGORIES = [
  "LinkedIn", "Facebook", "Instagram", "X", "Pinterest", 
  "Blog Featured Image", "Hero Banner", "Advertisement", 
  "Carousel", "Infographic", "Video Thumbnail", 
  "Product Image", "AI Avatar", "Logo Enhancement", "Custom"
];

const ASPECT_RATIOS = ["1:1", "4:5", "16:9", "9:16"];

export function ImageStudioPage() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  
  // Projects
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectBrand, setProjectBrand] = useState("");
  
  // Job Builder
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [category, setCategory] = useState("Custom");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [provider, setProvider] = useState("gemini");
  const [model, setModel] = useState("gemini-1.5-pro");
  const [batchSize, setBatchSize] = useState(1);
  const [autoUpscale, setAutoUpscale] = useState(false);
  
  // Jobs & Assets
  const [jobs, setJobs] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  
  useEffect(() => {
    fetchProjects();
  }, [user]);

  useEffect(() => {
    if (selectedProject) {
      fetchJobsAndAssets(selectedProject.id);
    }
  }, [selectedProject]);

  async function fetchProjects() {
    if (!user) return;
    setLoading(true);
    try {
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      if (profile?.organization_id) {
        const { data } = await supabase.from('image_projects')
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

  async function fetchJobsAndAssets(projectId: string) {
    try {
      const { data: jData } = await supabase.from('image_jobs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (jData) setJobs(jData);

      const { data: aData } = await supabase.from('image_assets')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (aData) setAssets(aData);
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
        const { data, error } = await supabase.from('image_projects').insert({
          name: projectName,
          brand: projectBrand,
          organization_id: profile.organization_id,
          created_by: user.id
        }).select().single();
        
        if (error) throw error;
        
        await fetchProjects();
        setCreateProjectOpen(false);
        setProjectName("");
        setProjectBrand("");
        if (data) setSelectedProject(data);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function handleCreateJob(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !selectedProject || !prompt.trim()) return;
    
    try {
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      if (profile?.organization_id) {
        const { data: job, error } = await supabase.from('image_jobs').insert({
          project_id: selectedProject.id,
          prompt,
          negative_prompt: negativePrompt,
          category,
          aspect_ratio: aspectRatio,
          provider,
          model,
          batch_size: batchSize,
          auto_upscale: autoUpscale,
          status: 'queued',
          organization_id: profile.organization_id,
          created_by: user.id
        }).select().single();
        
        if (error) throw error;
        
        await JobOrchestratorService.getInstance().enqueueJob(
            profile.organization_id,
            'image',
            {
                prompt,
                negative_prompt: negativePrompt,
                aspect_ratio: aspectRatio,
                batch_size: batchSize,
                model,
                providerId: provider,
                job_id: job.id,
                project_id: selectedProject.id
            },
            'medium'
        );
        
        setPrompt("");
        
        fetchJobsAndAssets(selectedProject.id);
      }
    } catch (err) {
      console.error(err);
    }
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
  const completedCount = jobs.filter(j => j.status === 'completed').length;
  const successRate = jobs.length > 0 ? Math.round((completedCount / jobs.length) * 100) : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Enterprise Image Studio</h1>
          <p className="text-muted-foreground">
            Centralized image generation engine for all organizational content.
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setCreateProjectOpen(true)} variant="outline">
            <Plus className="mr-2 h-4 w-4" /> New Project
          </Button>
        </div>
      </div>
      
      {/* Dashboard Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Images Generated</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{assets.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{successRate}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Queue Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{queuedCount} <span className="text-sm font-normal text-muted-foreground">pending</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top Provider</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Gemini</div>
          </CardContent>
        </Card>
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
                <div><span className="text-muted-foreground">Brand:</span> {selectedProject.brand || 'N/A'}</div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="md:col-span-3">
          {selectedProject ? (
            <Tabs defaultValue="generate" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="generate">Generate</TabsTrigger>
                <TabsTrigger value="queue">Queue & Jobs</TabsTrigger>
                <TabsTrigger value="library">Asset Library</TabsTrigger>
              </TabsList>
              
              <TabsContent value="generate" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Prompt Builder</CardTitle>
                    <CardDescription>Configure and queue a new image generation job.</CardDescription>
                  </CardHeader>
                  <form onSubmit={handleCreateJob}>
                    <CardContent className="space-y-4">
                      <div className="space-y-2">
                        <Label>Prompt</Label>
                        <Textarea 
                          placeholder="A futuristic city with flying cars, cyberpunk style..." 
                          value={prompt}
                          onChange={e => setPrompt(e.target.value)}
                          rows={4}
                          required
                        />
                      </div>
                      
                      <div className="space-y-2">
                        <Label>Negative Prompt</Label>
                        <Input 
                          placeholder="blurry, distorted, low quality, bad anatomy..." 
                          value={negativePrompt}
                          onChange={e => setNegativePrompt(e.target.value)}
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-2">
                          <Label>Category</Label>
                          <Select value={category} onValueChange={setCategory}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {IMAGE_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-2">
                          <Label>Aspect Ratio</Label>
                          <Select value={aspectRatio} onValueChange={setAspectRatio}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {ASPECT_RATIOS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-2">
                          <Label>Provider</Label>
                          <Select value={provider} onValueChange={setProvider}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="gemini">Google Gemini</SelectItem>
                              <SelectItem value="openai">OpenAI</SelectItem>
                              <SelectItem value="flux">FLUX</SelectItem>
                              <SelectItem value="comfyui">ComfyUI</SelectItem>
                              <SelectItem value="minimax">MiniMax</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        
                        <div className="space-y-2">
                          <Label>Batch Size</Label>
                          <Input type="number" min="1" max="4" value={batchSize} onChange={e => setBatchSize(parseInt(e.target.value))} />
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between border rounded-md p-4 mt-4">
                        <div className="space-y-0.5">
                          <Label>Auto Upscale</Label>
                          <p className="text-sm text-muted-foreground">Automatically run through ESRGAN upscaler after generation.</p>
                        </div>
                        <Switch checked={autoUpscale} onCheckedChange={setAutoUpscale} />
                      </div>
                    </CardContent>
                    <CardFooter>
                      <Button type="submit" disabled={!prompt.trim()}>Queue Generation</Button>
                    </CardFooter>
                  </form>
                </Card>
              </TabsContent>

              <TabsContent value="queue" className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Job Queue</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Prompt</TableHead>
                            <TableHead>Specs</TableHead>
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
                                <TableCell className="font-medium max-w-[300px] truncate">
                                  {job.prompt}
                                </TableCell>
                                <TableCell>
                                  <div className="flex gap-1 flex-wrap">
                                    <Badge variant="outline" className="text-[10px]">{job.category}</Badge>
                                    <Badge variant="outline" className="text-[10px]">{job.aspect_ratio}</Badge>
                                    <Badge variant="outline" className="text-[10px]">{job.provider}</Badge>
                                  </div>
                                </TableCell>
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

              <TabsContent value="library" className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
                  {assets.length === 0 ? (
                    <div className="col-span-full py-12 text-center border rounded-xl border-dashed">
                      <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <h3 className="text-lg font-medium">No Images Yet</h3>
                      <p className="text-muted-foreground mb-4 mt-1">Generate some images to see them in your library.</p>
                    </div>
                  ) : (
                    assets.map(asset => (
                      <Card key={asset.id} className="overflow-hidden group">
                        <div className="aspect-square relative overflow-hidden bg-muted">
                          {/* We use an img tag pointing to placeholder for now */}
                          <img 
                            src={asset.asset_url} 
                            alt={asset.prompt}
                            className="object-cover w-full h-full transition-transform group-hover:scale-105"
                            referrerPolicy="no-referrer"
                          />
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <Button size="icon" variant="secondary"><Download className="w-4 h-4" /></Button>
                            <Button size="icon" variant="secondary"><Copy className="w-4 h-4" /></Button>
                            <Button size="icon" variant="destructive"><Trash className="w-4 h-4" /></Button>
                          </div>
                          <div className="absolute top-2 left-2 flex gap-1">
                            <Badge variant="secondary" className="text-[10px]">{asset.category}</Badge>
                          </div>
                        </div>
                        <CardContent className="p-3">
                          <p className="text-xs text-muted-foreground line-clamp-2" title={asset.prompt}>{asset.prompt}</p>
                          <div className="flex justify-between items-center mt-2 text-[10px] text-muted-foreground">
                            <span>{asset.resolution}</span>
                            <span>{new Date(asset.created_at).toLocaleDateString()}</span>
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
              <ImageIcon className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium">Select a Project</h3>
              <p className="text-muted-foreground mb-4 mt-1">Choose a project from the sidebar or create a new one to get started.</p>
            </div>
          )}
        </div>
      </div>

      <Dialog open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
        <DialogContent>
          <form onSubmit={handleCreateProject}>
            <DialogHeader>
              <DialogTitle>Create Image Project</DialogTitle>
              <DialogDescription>Group related image generations into a single project space.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Project Name</Label>
                <Input required value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="e.g. Q4 Ad Campaign" />
              </div>
              <div className="space-y-2">
                <Label>Brand (Optional)</Label>
                <Input value={projectBrand} onChange={e => setProjectBrand(e.target.value)} placeholder="e.g. Acme Corp" />
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
