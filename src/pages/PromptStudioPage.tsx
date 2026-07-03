import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { AIManagerService } from "@/modules/ai-providers/AiProviderService";
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
import { Search, Plus, Play, History, Star, Edit, Trash2, Library, Wand2, TerminalSquare, Heart, Activity } from "lucide-react";

export function PromptStudioPage() {
  const { user } = useAuthStore();
  
  // Library state
  const [templates, setTemplates] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Search and Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategoryFilter, setSelectedCategoryFilter] = useState("all");
  
  // Dialog & Editor state
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  
  // Form state
  const [formData, setFormData] = useState<any>({
    title: "",
    description: "",
    category: "General",
    provider: "",
    default_model: "",
    temperature: 0.7,
    max_tokens: 2048,
    system_prompt: "",
    user_prompt: "",
    tags: []
  });

  // Playground state
  const [playgroundOpen, setPlaygroundOpen] = useState(false);
  const [playgroundTemplate, setPlaygroundTemplate] = useState<any>(null);
  const [playgroundVariables, setPlaygroundVariables] = useState<Record<string, string>>({});
  const [playgroundResponse, setPlaygroundResponse] = useState("");
  const [playgroundTesting, setPlaygroundTesting] = useState(false);
  const [playgroundLatency, setPlaygroundLatency] = useState(0);

  const defaultCategories = [
    "SEO", "Blog", "LinkedIn", "Twitter/X", "Facebook", "Instagram", 
    "YouTube", "Email", "WhatsApp", "Image Generation", "Video Generation", 
    "Voice", "RFQ", "CRM", "General"
  ];

  useEffect(() => {
    fetchData();
  }, [user]);

  async function fetchData() {
    if (!user) return;
    setLoading(true);
    try {
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      if (profile?.organization_id) {
        const orgId = profile.organization_id;
        
        // Fetch Templates
        const { data: templatesData } = await supabase.from('prompt_templates').select('*').eq('organization_id', orgId).order('created_at', { ascending: false });
        if (templatesData) setTemplates(templatesData);
        
        // Fetch Favorites
        const { data: favData } = await supabase.from('prompt_favorites').select('template_id').eq('user_id', user.id);
        if (favData) {
          setFavorites(new Set(favData.map(f => f.template_id)));
        }
        
        // Fetch Logs
        const { data: logData } = await supabase.from('prompt_executions')
          .select('*, prompt_templates(title), ai_request_logs(*)')
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false })
          .limit(50);
        if (logData) setLogs(logData);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const toggleFavorite = async (templateId: string) => {
    if (!user) return;
    try {
      if (favorites.has(templateId)) {
        await supabase.from('prompt_favorites').delete().match({ user_id: user.id, template_id: templateId });
        const newFavs = new Set(favorites);
        newFavs.delete(templateId);
        setFavorites(newFavs);
      } else {
        await supabase.from('prompt_favorites').insert({ user_id: user.id, template_id: templateId });
        const newFavs = new Set(favorites);
        newFavs.add(templateId);
        setFavorites(newFavs);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    try {
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      
      if (profile?.organization_id) {
        const payload = {
          ...formData,
          organization_id: profile.organization_id,
          created_by: user.id
        };
        
        if (editingTemplate) {
          await supabase.from('prompt_templates').update(payload).eq('id', editingTemplate.id);
          // Insert version history
          await supabase.from('prompt_versions').insert({
            template_id: editingTemplate.id,
            version_number: (editingTemplate.version || 1) + 1,
            system_prompt: payload.system_prompt,
            user_prompt: payload.user_prompt,
            created_by: user.id
          });
          // Update version number
          await supabase.from('prompt_templates').update({ version: (editingTemplate.version || 1) + 1 }).eq('id', editingTemplate.id);
        } else {
          await supabase.from('prompt_templates').insert(payload);
        }
        
        setEditorOpen(false);
        fetchData();
      }
    } catch (err) {
      console.error(err);
      alert("Failed to save template.");
    }
  };

  const openNewTemplate = () => {
    setEditingTemplate(null);
    setFormData({
      title: "",
      description: "",
      category: "General",
      provider: "",
      default_model: "",
      temperature: 0.7,
      max_tokens: 2048,
      system_prompt: "",
      user_prompt: "",
      tags: []
    });
    setEditorOpen(true);
  };

  const openEditTemplate = (t: any) => {
    setEditingTemplate(t);
    setFormData({ ...t });
    setEditorOpen(true);
  };
  
  const extractVariables = (text: string) => {
    if (!text) return [];
    const regex = /{{\s*([a-zA-Z0-9_]+)\s*}}/g;
    const matches = Array.from(text.matchAll(regex));
    return [...new Set(matches.map(m => m[1]))];
  };

  const openPlayground = (t: any) => {
    setPlaygroundTemplate(t);
    const vars = extractVariables(t.user_prompt + (t.system_prompt || ""));
    const initialVars: Record<string, string> = {};
    vars.forEach(v => initialVars[v] = "");
    setPlaygroundVariables(initialVars);
    setPlaygroundResponse("");
    setPlaygroundLatency(0);
    setPlaygroundOpen(true);
  };

  const handleTestPrompt = async () => {
    if (!user || !playgroundTemplate) return;
    setPlaygroundTesting(true);
    setPlaygroundResponse("Generating...");
    
    try {
      let finalSystemPrompt = playgroundTemplate.system_prompt || "";
      let finalUserPrompt = playgroundTemplate.user_prompt || "";
      
      // Interpolate variables
      Object.entries(playgroundVariables).forEach(([key, val]) => {
        const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'g');
        finalSystemPrompt = finalSystemPrompt.replace(regex, val);
        finalUserPrompt = finalUserPrompt.replace(regex, val);
      });
      
      const fullPrompt = finalSystemPrompt ? `${finalSystemPrompt}\n\n${finalUserPrompt}` : finalUserPrompt;
      
      const manager = AIManagerService.getInstance();
      const start = Date.now();
      const { text: result, logId } = await manager.generate(fullPrompt, user.id);
      const latency = Date.now() - start;
      
      setPlaygroundResponse(result);
      setPlaygroundLatency(latency);
      
      // Log execution
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      if (profile?.organization_id) {
        await supabase.from('prompt_executions').insert({
          template_id: playgroundTemplate.id,
          variables_json: playgroundVariables,
          response_text: result,
          ai_log_id: logId,
          organization_id: profile.organization_id,
          created_by: user.id
        });
        fetchData();
      }
      
    } catch (err: any) {
      console.error(err);
      setPlaygroundResponse(`Error: ${err.message || String(err)}`);
    } finally {
      setPlaygroundTesting(false);
    }
  };

  const filteredTemplates = templates.filter(t => {
    const matchesSearch = t.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (t.description && t.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategoryFilter === 'all' || t.category === selectedCategoryFilter;
    const matchesFav = selectedCategoryFilter === 'favorites' ? favorites.has(t.id) : true;
    
    if (selectedCategoryFilter === 'favorites') return matchesSearch && matchesFav;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Prompt Studio</h1>
          <p className="text-muted-foreground">
            Manage your prompt library, templates, and execution history.
          </p>
        </div>
      </div>

      <Tabs defaultValue="library" className="w-full">
        <TabsList className="grid w-full sm:w-auto grid-cols-2 mb-4">
          <TabsTrigger value="library"><Library className="h-4 w-4 mr-2"/> Library</TabsTrigger>
          <TabsTrigger value="logs"><History className="h-4 w-4 mr-2"/> Executions</TabsTrigger>
        </TabsList>
        
        <TabsContent value="library" className="space-y-4">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <div className="flex flex-1 w-full gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search templates..."
                  className="pl-8"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <Select value={selectedCategoryFilter} onValueChange={setSelectedCategoryFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="favorites">Favorites</SelectItem>
                  {defaultCategories.map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={openNewTemplate}>
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredTemplates.map((t) => (
              <Card key={t.id} className="flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg">{t.title}</CardTitle>
                        {favorites.has(t.id) && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}
                      </div>
                      <Badge variant="secondary" className="text-xs">{t.category}</Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleFavorite(t.id)}>
                        <Star className={`h-4 w-4 ${favorites.has(t.id) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'}`} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditTemplate(t)}>
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-2 flex-grow">
                  <p className="text-sm text-muted-foreground line-clamp-3">
                    {t.description || "No description provided."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-1">
                    {extractVariables(t.user_prompt + (t.system_prompt || "")).map((v, i) => (
                      <Badge key={i} variant="outline" className="text-[10px] bg-primary/5">
                        {v}
                      </Badge>
                    ))}
                  </div>
                </CardContent>
                <CardFooter className="pt-2 border-t mt-auto">
                  <Button variant="default" className="w-full" onClick={() => openPlayground(t)}>
                    <Play className="h-4 w-4 mr-2" /> Open in Playground
                  </Button>
                </CardFooter>
              </Card>
            ))}
            
            {filteredTemplates.length === 0 && !loading && (
              <div className="col-span-full py-12 text-center border rounded-xl border-dashed">
                <TerminalSquare className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No Templates Found</h3>
                <p className="text-muted-foreground mb-4 mt-1">Try a different search or create your first prompt template.</p>
                <Button onClick={openNewTemplate}>Create Template</Button>
              </div>
            )}
          </div>
        </TabsContent>
        
        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Execution History</CardTitle>
              <CardDescription>Recent prompt executions across the organization.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Template</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Tokens</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                          No executions found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      logs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="whitespace-nowrap text-xs">
                            {new Date(log.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="font-medium">
                            {log.prompt_templates?.title || 'Unknown Template'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {log.ai_request_logs?.provider_id || '—'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {log.ai_request_logs?.model || '—'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {log.ai_request_logs?.tokens_used || '—'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {log.ai_request_logs?.latency_ms ? `${log.ai_request_logs.latency_ms}ms` : '—'}
                          </TableCell>
                          <TableCell>
                            {log.ai_request_logs?.status === 'ERROR' ? (
                              <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20">Failed</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Success</Badge>
                            )}
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
      </Tabs>

      {/* Editor Dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleSaveTemplate}>
            <DialogHeader>
              <DialogTitle>{editingTemplate ? 'Edit Template' : 'Create Template'}</DialogTitle>
              <DialogDescription>
                Define your prompt template. Use {'{{variable_name}}'} syntax for dynamic inputs.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 sm:col-span-1 space-y-2">
                  <Label>Title</Label>
                  <Input 
                    required 
                    placeholder="e.g. SEO Meta Description" 
                    value={formData.title} 
                    onChange={e => setFormData({...formData, title: e.target.value})} 
                  />
                </div>
                <div className="col-span-2 sm:col-span-1 space-y-2">
                  <Label>Category</Label>
                  <Select 
                    value={formData.category} 
                    onValueChange={v => setFormData({...formData, category: v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {defaultCategories.map(c => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>Description</Label>
                  <Input 
                    placeholder="Brief description of what this prompt does..." 
                    value={formData.description} 
                    onChange={e => setFormData({...formData, description: e.target.value})} 
                  />
                </div>
                
                <div className="col-span-2 pt-4 border-t">
                  <h4 className="text-sm font-medium mb-4">Prompt Configuration</h4>
                </div>
                
                <div className="col-span-2 space-y-2">
                  <Label>System Prompt (Optional)</Label>
                  <Textarea 
                    placeholder="You are an expert SEO copywriter..." 
                    className="min-h-[100px] font-mono text-sm"
                    value={formData.system_prompt} 
                    onChange={e => setFormData({...formData, system_prompt: e.target.value})} 
                  />
                </div>
                
                <div className="col-span-2 space-y-2">
                  <Label>User Prompt <span className="text-red-500">*</span></Label>
                  <Textarea 
                    required
                    placeholder="Generate a meta description for {{company}} in the {{industry}} industry..." 
                    className="min-h-[150px] font-mono text-sm"
                    value={formData.user_prompt} 
                    onChange={e => setFormData({...formData, user_prompt: e.target.value})} 
                  />
                  <p className="text-xs text-muted-foreground">Detected variables: {extractVariables(formData.user_prompt + (formData.system_prompt || "")).join(", ") || "None"}</p>
                </div>

                <div className="col-span-2 pt-4 border-t">
                  <h4 className="text-sm font-medium mb-4">Generation Defaults (Optional Overrides)</h4>
                </div>

                <div className="space-y-2">
                  <Label>Temperature ({formData.temperature})</Label>
                  <Input 
                    type="number" 
                    step="0.1"
                    min="0"
                    max="2"
                    value={formData.temperature} 
                    onChange={e => setFormData({...formData, temperature: parseFloat(e.target.value)})} 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Max Tokens</Label>
                  <Input 
                    type="number" 
                    value={formData.max_tokens} 
                    onChange={e => setFormData({...formData, max_tokens: parseInt(e.target.value)})} 
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditorOpen(false)}>Cancel</Button>
              <Button type="submit">Save Template</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Playground Dialog */}
      <Dialog open={playgroundOpen} onOpenChange={setPlaygroundOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TerminalSquare className="h-5 w-5" /> 
              Playground: {playgroundTemplate?.title}
            </DialogTitle>
            <DialogDescription>
              Fill in the variables and execute this prompt using your unified AI providers.
            </DialogDescription>
          </DialogHeader>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 py-4 h-full">
            <div className="md:col-span-1 space-y-6 flex flex-col h-full border-r pr-6">
              <div className="space-y-4">
                <h4 className="font-medium text-sm border-b pb-2">Variables</h4>
                {Object.keys(playgroundVariables).length === 0 ? (
                  <p className="text-sm text-muted-foreground italic">No variables detected in this prompt.</p>
                ) : (
                  Object.keys(playgroundVariables).map(key => (
                    <div key={key} className="space-y-2">
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{key}</Label>
                      <Input 
                        value={playgroundVariables[key]}
                        onChange={(e) => setPlaygroundVariables({...playgroundVariables, [key]: e.target.value})}
                        placeholder={`Value for ${key}...`}
                      />
                    </div>
                  ))
                )}
              </div>
              
              <div className="mt-auto pt-6">
                <Button className="w-full" onClick={handleTestPrompt} disabled={playgroundTesting}>
                  {playgroundTesting ? (
                    <><Activity className="mr-2 h-4 w-4 animate-spin" /> Executing...</>
                  ) : (
                    <><Play className="mr-2 h-4 w-4" /> Execute Prompt</>
                  )}
                </Button>
              </div>
            </div>
            
            <div className="md:col-span-2 flex flex-col space-y-4">
              <div className="flex-1 space-y-2">
                <Label>Response</Label>
                <div className="p-4 bg-muted/30 border rounded-md min-h-[300px] font-mono text-sm whitespace-pre-wrap relative">
                  {playgroundResponse ? playgroundResponse : (
                    <span className="text-muted-foreground italic flex items-center justify-center h-full absolute inset-0">
                      Response will appear here...
                    </span>
                  )}
                </div>
                {playgroundLatency > 0 && (
                  <p className="text-xs text-muted-foreground text-right">
                    Latency: {playgroundLatency}ms
                  </p>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
