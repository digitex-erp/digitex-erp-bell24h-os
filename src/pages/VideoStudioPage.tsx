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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Plus, RefreshCw, Video as VideoIcon, CheckCircle2, XCircle, Clock, PlayCircle, Download, Trash, Copy } from "lucide-react";

const VIDEO_TYPES = [
  "LinkedIn", "YouTube Shorts", "Instagram Reel", "Facebook Reel", "X Video", 
  "Product Demo", "Explainer", "Corporate", "Testimonial", "AI Avatar", 
  "Marketing", "Educational", "Presentation", "Custom"
];

const ASPECT_RATIOS = ["16:9", "9:16", "1:1", "4:3"];
const DURATIONS = ["5s", "10s", "15s", "30s", "60s"];
const FRAME_RATES = ["24fps", "30fps", "60fps"];
const QUALITIES = ["720p", "1080p", "4K"];
const PROVIDERS = [
  { id: "opensora", name: "Open-Sora" },
  { id: "cogvideox", name: "CogVideoX" },
  { id: "ltxvideo", name: "LTX Video" },
  { id: "hunyuan", name: "Hunyuan Video" },
  { id: "minimax", name: "MiniMax" }
];

export function VideoStudioPage() {
  const { user } = useAuthStore();
  const [loading, setLoading] = useState(true);
  
  const [projects, setProjects] = useState<any[]>([]);
  const [selectedProject, setSelectedProject] = useState<any>(null);
  const [isNewProjectOpen, setIsNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectBrand, setNewProjectBrand] = useState("");
  
  const [jobs, setJobs] = useState<any[]>([]);
  const [assets, setAssets] = useState<any[]>([]);
  
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [videoType, setVideoType] = useState(VIDEO_TYPES[0]);
  const [aspectRatio, setAspectRatio] = useState(ASPECT_RATIOS[0]);
  const [duration, setDuration] = useState(DURATIONS[0]);
  const [frameRate, setFrameRate] = useState(FRAME_RATES[0]);
  const [quality, setQuality] = useState(QUALITIES[0]);
  const [provider, setProvider] = useState(PROVIDERS[0].id);
  const [model, setModel] = useState("default");
  
  // State
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  useEffect(() => {
    if (user) {
      fetchProjects();
    }
  }, [user]);

  useEffect(() => {
    if (selectedProject) {
      fetchJobsAndAssets(selectedProject.id);
    }
  }, [selectedProject]);

  async function fetchProjects() {
    try {
      const { data: orgData } = await supabase.from('profiles').select('organization_id').eq('id', user?.id).single();
      if (!orgData?.organization_id) return;
      
      const { data, error } = await supabase.from('video_projects')
        .select('*')
        .eq('organization_id', orgData.organization_id)
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      setProjects(data || []);
      if (data && data.length > 0 && !selectedProject) {
        setSelectedProject(data[0]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchJobsAndAssets(projectId: string) {
    try {
      const { data: jData } = await supabase.from('video_jobs')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
        
      setJobs(jData || []);
      
      const { data: aData } = await supabase.from('video_assets')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
        
      setAssets(aData || []);
    } catch (err) {
      console.error(err);
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newProjectName.trim() || !user) return;
    
    try {
      const { data: orgData } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      if (!orgData?.organization_id) return;
      
      const { data, error } = await supabase.from('video_projects').insert({
        name: newProjectName,
        brand: newProjectBrand,
        organization_id: orgData.organization_id,
        created_by: user.id
      }).select().single();
      
      if (error) throw error;
      
      setProjects([data, ...projects]);
      setSelectedProject(data);
      setIsNewProjectOpen(false);
      setNewProjectName("");
      setNewProjectBrand("");
    } catch (err) {
      console.error(err);
    }
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || !selectedProject || !user) return;
    
    setIsSubmitting(true);
    try {
      const { data: orgData } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      
      const { data: job, error } = await supabase.from('video_jobs').insert({
        project_id: selectedProject.id,
        prompt,
        negative_prompt: negativePrompt,
        video_type: videoType,
        aspect_ratio: aspectRatio,
        duration: duration,
        frame_rate: frameRate,
        quality: quality,
        provider,
        model,
        status: 'queued',
        organization_id: orgData?.organization_id,
        created_by: user.id
      }).select().single();
      
      if (error) throw error;
      
      await JobOrchestratorService.getInstance().enqueueJob(
          orgData?.organization_id,
          'video',
          {
              prompt,
              negative_prompt: negativePrompt,
              aspect_ratio: aspectRatio,
              duration,
              frame_rate: frameRate,
              quality,
              model,
              providerId: provider,
              job_id: job.id,
              project_id: selectedProject.id
          },
          'medium'
      );
      
      setJobs([job, ...jobs]);
      setPrompt("");
      
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  }


  function getStatusBadge(status: string) {
    switch(status) {
      case 'completed': return <Badge className="bg-green-100 text-green-800"><CheckCircle2 className="w-3 h-3 mr-1"/> Completed</Badge>;
      case 'running': return <Badge className="bg-blue-100 text-blue-800"><Loader2 className="w-3 h-3 mr-1 animate-spin"/> Running</Badge>;
      case 'queued': return <Badge className="bg-gray-100 text-gray-800"><Clock className="w-3 h-3 mr-1"/> Queued</Badge>;
      case 'failed': return <Badge className="bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1"/> Failed</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  }

  if (loading) return <div className="flex items-center justify-center h-full"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>;

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center justify-between p-4 border-b shrink-0 bg-white">
        <div className="flex items-center gap-2 text-xl font-semibold">
          <VideoIcon className="w-6 h-6" />
          Enterprise Video Studio
        </div>
        
        <div className="flex items-center gap-4">
          {projects.length > 0 && (
            <Select value={selectedProject?.id} onValueChange={(v) => setSelectedProject(projects.find(p => p.id === v))}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select Project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map(p => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          
          <Dialog open={isNewProjectOpen} onOpenChange={setIsNewProjectOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="w-4 h-4 mr-2" /> New Project</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New Video Project</DialogTitle>
                <DialogDescription>Create a project to organize your video generation jobs and assets.</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateProject}>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Project Name</Label>
                    <Input placeholder="e.g. Q3 Marketing Videos" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} autoFocus />
                  </div>
                  <div className="space-y-2">
                    <Label>Brand (Optional)</Label>
                    <Input placeholder="e.g. Bell24h" value={newProjectBrand} onChange={e => setNewProjectBrand(e.target.value)} />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setIsNewProjectOpen(false)}>Cancel</Button>
                  <Button type="submit">Create Project</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!selectedProject ? (
        <div className="flex flex-col items-center justify-center flex-1 text-gray-500">
          <VideoIcon className="w-16 h-16 mb-4 text-gray-300" />
          <h3 className="text-xl font-medium mb-2">No Projects Found</h3>
          <p className="mb-4">Create a video project to start generating videos.</p>
          <Button onClick={() => setIsNewProjectOpen(true)}><Plus className="w-4 h-4 mr-2" /> Create First Project</Button>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tools */}
          <div className="w-[400px] border-r overflow-y-auto bg-gray-50/50 flex flex-col shrink-0">
            <div className="p-4 border-b font-medium">Generation Settings</div>
            
            <form onSubmit={handleGenerate} className="p-4 space-y-6 flex-1">
              <div className="space-y-2">
                <Label>Video Prompt</Label>
                <Textarea 
                  placeholder="Describe the video you want to generate in detail..." 
                  className="h-32 resize-none"
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Negative Prompt (Optional)</Label>
                <Textarea 
                  placeholder="Things to avoid in the video..." 
                  className="h-16 resize-none"
                  value={negativePrompt}
                  onChange={e => setNegativePrompt(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Video Type</Label>
                  <Select value={videoType} onValueChange={setVideoType}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {VIDEO_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Aspect Ratio</Label>
                  <Select value={aspectRatio} onValueChange={setAspectRatio}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {ASPECT_RATIOS.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Duration</Label>
                  <Select value={duration} onValueChange={setDuration}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {DURATIONS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Frame Rate</Label>
                  <Select value={frameRate} onValueChange={setFrameRate}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {FRAME_RATES.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Quality</Label>
                  <Select value={quality} onValueChange={setQuality}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {QUALITIES.map(q => <SelectItem key={q} value={q}>{q}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Provider</Label>
                  <Select value={provider} onValueChange={setProvider}>
                    <SelectTrigger><SelectValue/></SelectTrigger>
                    <SelectContent>
                      {PROVIDERS.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting || !prompt.trim()}>
                {isSubmitting ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Queuing...</> : "Generate Video"}
              </Button>
            </form>
          </div>
          
          {/* Main Area */}
          <div className="flex-1 overflow-y-auto bg-gray-50">
            <div className="p-6">
              <Tabs defaultValue="assets">
                <div className="flex items-center justify-between mb-6">
                  <TabsList>
                    <TabsTrigger value="assets">Video Assets ({assets.length})</TabsTrigger>
                    <TabsTrigger value="jobs">Generation Queue ({jobs.length})</TabsTrigger>
                  </TabsList>
                  
                  <Button variant="outline" size="sm" onClick={() => fetchJobsAndAssets(selectedProject.id)}>
                    <RefreshCw className="w-4 h-4 mr-2" /> Refresh
                  </Button>
                </div>

                <TabsContent value="assets" className="m-0">
                  {assets.length === 0 ? (
                    <div className="text-center py-20 text-gray-500 bg-white rounded-lg border border-dashed">
                      <VideoIcon className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p>No video assets generated yet.</p>
                      <p className="text-sm">Use the panel on the left to generate your first video.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                      {assets.map(asset => (
                        <Card key={asset.id} className="overflow-hidden group">
                          <div className="aspect-video bg-black relative flex items-center justify-center">
                            <video 
                              src={asset.asset_url} 
                              className="w-full h-full object-contain"
                              controls
                              poster={asset.thumbnail_url}
                            />
                            {!asset.asset_url && (
                               <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                                   No Video Source
                               </div>
                            )}
                          </div>
                          <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="secondary" className="text-xs">{asset.video_type}</Badge>
                              <Badge variant="outline" className="text-xs">{asset.resolution} • {asset.duration}</Badge>
                            </div>
                            <p className="text-sm text-gray-600 line-clamp-3 mb-4">{asset.prompt}</p>
                            <div className="flex items-center justify-between mt-auto">
                              <span className="text-xs text-gray-400 font-mono">ID: {asset.id.slice(0,8)}</span>
                              <div className="flex gap-2">
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => window.open(asset.asset_url, '_blank')}><Download className="w-4 h-4" /></Button>
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="jobs" className="m-0">
                  <Card>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Status</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Prompt</TableHead>
                          <TableHead>Provider</TableHead>
                          <TableHead>Settings</TableHead>
                          <TableHead>Created</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {jobs.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center py-8 text-gray-500">No jobs in queue.</TableCell>
                          </TableRow>
                        ) : jobs.map(job => (
                          <TableRow key={job.id}>
                            <TableCell>{getStatusBadge(job.status)}</TableCell>
                            <TableCell>{job.video_type}</TableCell>
                            <TableCell className="max-w-[200px] truncate" title={job.prompt}>{job.prompt}</TableCell>
                            <TableCell className="capitalize">{job.provider}</TableCell>
                            <TableCell className="text-xs text-gray-500">
                              {job.aspect_ratio} • {job.duration} • {job.quality}
                            </TableCell>
                            <TableCell className="text-sm text-gray-500">{new Date(job.created_at).toLocaleString()}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Card>
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
