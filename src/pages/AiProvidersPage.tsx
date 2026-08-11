import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, BrainCircuit, Activity, Settings2, Plus, Edit, Trash2, Power, History, Settings, Play } from "lucide-react";
import { AIManagerService } from "@/modules/ai-providers/AiProviderService";

export function AiProvidersPage() {
  const { user } = useAuthStore();
  const [providers, setProviders] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Dialog state
  const [providerOpen, setProviderOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<any>(null);
  
  // Playground state
  const [testPrompt, setTestPrompt] = useState("");
  const [testResponse, setTestResponse] = useState("");
  const [testing, setTesting] = useState(false);
  
  // Provider Form state
  const [formData, setFormData] = useState<any>({
    name: "",
    provider_id: "",
    status: "ACTIVE",
    priority: 0,
    api_key: "",
    default_model: "",
    temperature: 0.7,
    max_tokens: 2048,
    timeout_ms: 30000,
    retry_count: 3
  });

  useEffect(() => {
    fetchProviders();
    fetchLogs();
  }, [user]);

  async function fetchProviders() {
    if (!user) return;
    setLoading(true);
    try {
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      if (profile?.organization_id) {
        // api_key deliberately EXCLUDED — this page never displays it (the key input
        // is always blank, with "Leave blank to keep existing key"), so the previous
        // select('*') was an over-fetch that put credentials in the browser.
        const { data } = await supabase
          .from('ai_providers')
          .select('id, name, provider_id, status, priority, default_model, temperature, max_tokens, timeout_ms, retry_count, last_request_at, last_error, organization_id, created_at, updated_at')
          .eq('organization_id', profile.organization_id)
          .order('priority', { ascending: true });
        if (data) setProviders(data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }
  
  async function fetchLogs() {
    if (!user) return;
    try {
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      if (profile?.organization_id) {
        const { data } = await supabase.from('ai_request_logs')
          .select('*, ai_providers(name, provider_id)')
          .eq('organization_id', profile.organization_id)
          .order('created_at', { ascending: false })
          .limit(50);
        if (data) setLogs(data);
      }
    } catch (err) {
      console.error(err);
    }
  }

  const handleSaveProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    
    try {
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();

      if (profile?.organization_id) {
        // BR-01 P0: api_key is deliberately dropped from the outgoing payload. The
        // browser must never write a raw provider credential to a tenant-readable
        // table — see AiProviderService.ts header comment and
        // docs/project/AA-01-TICKETS.md (AA-01-004). Provider key configuration is
        // disabled in the UI below pending a server-side secret-storage endpoint.
        const { api_key, ...formDataWithoutKey } = formData;
        const payload = {
          ...formDataWithoutKey,
          organization_id: profile.organization_id
        };

        if (editingProvider) {
          await supabase.from('ai_providers').update(payload).eq('id', editingProvider.id);
        } else {
          await supabase.from('ai_providers').insert(payload);
        }
        
        setProviderOpen(false);
        fetchProviders();
      }
    } catch (err) {
      console.error(err);
      alert("Failed to save provider.");
    }
  };

  const openNewProvider = () => {
    setEditingProvider(null);
    setFormData({
      name: "",
      provider_id: "gemini",
      status: "ACTIVE",
      priority: providers.length,
      api_key: "",
      default_model: "",
      temperature: 0.7,
      max_tokens: 2048,
      timeout_ms: 30000,
      retry_count: 3
    });
    setProviderOpen(true);
  };

  const openEditProvider = (p: any) => {
    setEditingProvider(p);
    setFormData({ ...p });
    setProviderOpen(true);
  };

  const toggleStatus = async (p: any) => {
    try {
      const newStatus = p.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await supabase.from('ai_providers').update({ status: newStatus }).eq('id', p.id);
      fetchProviders();
    } catch (err) {
      console.error(err);
    }
  };

  const handleTestAPI = async () => {
    if (!testPrompt.trim() || !user) return;
    setTesting(true);
    setTestResponse("Generating response...");
    
    try {
      const manager = AIManagerService.getInstance();
      const { text: result } = await manager.generate(testPrompt, user.id);
      setTestResponse(result);
      // Fetch logs after testing to show the new log
      fetchLogs();
    } catch (err: any) {
      console.error(err);
      setTestResponse(`Error: ${err.message || String(err)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Providers</h1>
          <p className="text-muted-foreground">
            Manage your AI models, configure fallback behaviors, and monitor usage.
          </p>
        </div>
      </div>

      <Tabs defaultValue="providers" className="w-full">
        <TabsList className="grid w-full sm:w-auto grid-cols-4 mb-4">
          <TabsTrigger value="providers"><BrainCircuit className="h-4 w-4 mr-2"/> Providers</TabsTrigger>
          <TabsTrigger value="logs"><History className="h-4 w-4 mr-2"/> Request Logs</TabsTrigger>
          <TabsTrigger value="playground"><Play className="h-4 w-4 mr-2"/> Playground</TabsTrigger>
          <TabsTrigger value="settings"><Settings className="h-4 w-4 mr-2"/> Settings</TabsTrigger>
        </TabsList>
        
        <TabsContent value="providers" className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-medium">Configured Providers</h2>
            <Button onClick={openNewProvider}>
              <Plus className="h-4 w-4 mr-2" />
              Add Provider
            </Button>
          </div>
          
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {providers.map((p) => (
              <Card key={p.id} className={p.status !== 'ACTIVE' ? "opacity-75 bg-muted/20" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        {p.name}
                        {p.status === 'ACTIVE' ? (
                          <span className="flex h-2 w-2 rounded-full bg-emerald-500"></span>
                        ) : p.status === 'ERROR' ? (
                          <span className="flex h-2 w-2 rounded-full bg-red-500"></span>
                        ) : (
                          <span className="flex h-2 w-2 rounded-full bg-slate-500"></span>
                        )}
                      </CardTitle>
                      <CardDescription>{p.provider_id} • Priority: {p.priority}</CardDescription>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEditProvider(p)}>
                        <Settings2 className="h-4 w-4" />
                      </Button>
                      <Switch 
                        checked={p.status === 'ACTIVE'} 
                        onCheckedChange={() => toggleStatus(p)} 
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pb-2">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Default Model</span>
                      <span className="font-medium truncate max-w-[150px]">{p.default_model || "None"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Config</span>
                      <span>Temp: {p.temperature} • Max: {p.max_tokens}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Health</span>
                      {p.last_error ? (
                        <span className="text-red-500 flex items-center text-xs truncate max-w-[150px]" title={p.last_error}>
                          Error recorded
                        </span>
                      ) : (
                        <span className="text-emerald-500">Healthy</span>
                      )}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Last Request</span>
                      <span>{p.last_request_at ? new Date(p.last_request_at).toLocaleTimeString() : 'Never'}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            
            {providers.length === 0 && !loading && (
              <div className="col-span-full py-12 text-center border rounded-xl border-dashed">
                <BrainCircuit className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No AI Providers Configured</h3>
                <p className="text-muted-foreground mb-4 mt-1">Add your first AI provider to enable smart features.</p>
                <Button onClick={openNewProvider}>Add Provider</Button>
              </div>
            )}
          </div>
        </TabsContent>
        
        <TabsContent value="logs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>AI Request Logs</CardTitle>
              <CardDescription>History of all API calls made to AI providers.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Timestamp</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Tokens (P/C)</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                          No logs found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      logs.map((log) => (
                        <TableRow key={log.id}>
                          <TableCell className="whitespace-nowrap text-xs">
                            {new Date(log.created_at).toLocaleString()}
                          </TableCell>
                          <TableCell className="font-medium">
                            {log.ai_providers?.name || 'Unknown'}
                          </TableCell>
                          <TableCell className="text-sm">{log.model}</TableCell>
                          <TableCell className="text-sm">
                            {log.tokens_used ? `${log.prompt_tokens || 0}/${log.completion_tokens || 0} (${log.tokens_used})` : '—'}
                          </TableCell>
                          <TableCell className="text-sm">
                            {log.latency_ms ? `${log.latency_ms}ms` : '—'}
                          </TableCell>
                          <TableCell>
                            {log.status === 'SUCCESS' ? (
                              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Success</Badge>
                            ) : (
                              <Badge variant="outline" className="bg-red-500/10 text-red-500 border-red-500/20" title={log.error_message || ''}>Failed</Badge>
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
        
        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Global AI Settings</CardTitle>
              <CardDescription>Configure organization-wide AI behaviors.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Enable Automatic Failover</Label>
                    <p className="text-sm text-muted-foreground">Automatically route to the next provider if the primary fails.</p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Rate Limiting</Label>
                    <p className="text-sm text-muted-foreground">Enforce organization-wide rate limits on AI usage.</p>
                  </div>
                  <Switch defaultChecked />
                </div>
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label>Cost Tracking</Label>
                    <p className="text-sm text-muted-foreground">Estimate and track costs based on token usage.</p>
                  </div>
                  <Switch defaultChecked />
                </div>
              </div>
              
              <div className="pt-4 border-t">
                <Button>Save Settings</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="playground" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Unified AI API Playground</CardTitle>
              <CardDescription>Test your configured providers through the centralized AIManagerService. The manager handles routing, fallback, and logging automatically.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Prompt</Label>
                <div className="flex gap-2">
                  <Input 
                    value={testPrompt}
                    onChange={(e) => setTestPrompt(e.target.value)}
                    placeholder="Enter a prompt to test your AI providers..."
                    onKeyDown={(e) => { if (e.key === 'Enter') handleTestAPI(); }}
                  />
                  <Button onClick={handleTestAPI} disabled={testing || !testPrompt.trim() || providers.length === 0}>
                    {testing ? "Testing..." : "Send Request"}
                  </Button>
                </div>
              </div>
              
              <div className="space-y-2 mt-4 pt-4 border-t">
                <Label>Response</Label>
                <div className="p-4 bg-muted/50 rounded-md min-h-[150px] font-mono text-sm whitespace-pre-wrap">
                  {testResponse || "No response yet."}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={providerOpen} onOpenChange={setProviderOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleSaveProvider}>
            <DialogHeader>
              <DialogTitle>{editingProvider ? 'Edit Provider' : 'Add AI Provider'}</DialogTitle>
              <DialogDescription>
                Configure connection details and defaults for this provider.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input 
                    required 
                    placeholder="e.g. Primary OpenAI" 
                    value={formData.name} 
                    onChange={e => setFormData({...formData, name: e.target.value})} 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Provider Type</Label>
                  <Select 
                    value={formData.provider_id} 
                    onValueChange={v => setFormData({...formData, provider_id: v})}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gemini">Google Gemini</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="nvidia">NVIDIA NIM</SelectItem>
                      <SelectItem value="minimax">MiniMax</SelectItem>
                      <SelectItem value="deepseek">DeepSeek</SelectItem>
                      <SelectItem value="qwen">Qwen</SelectItem>
                      <SelectItem value="glm">GLM</SelectItem>
                      <SelectItem value="opensora">Open-Sora</SelectItem>
                      <SelectItem value="cogvideox">CogVideoX</SelectItem>
                      <SelectItem value="ltxvideo">LTX Video</SelectItem>
                      <SelectItem value="hunyuan">Hunyuan Video</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-2">
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    disabled
                    placeholder="Not available from this page — see note below"
                    value={formData.api_key}
                    onChange={e => setFormData({...formData, api_key: e.target.value})}
                  />
                  <p className="text-xs text-muted-foreground">
                    Provider keys can no longer be set from the browser (BR-01 P0
                    fix): this field is disabled and never transmitted or saved.
                    Key configuration requires a server-side endpoint, which is not
                    yet built — tracked as AA-01-002/AA-01-004.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Default Model</Label>
                  <Input 
                    placeholder="e.g. gemini-1.5-pro" 
                    value={formData.default_model} 
                    onChange={e => setFormData({...formData, default_model: e.target.value})} 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Priority (0 is highest)</Label>
                  <Input 
                    type="number" 
                    value={formData.priority} 
                    onChange={e => setFormData({...formData, priority: parseInt(e.target.value)})} 
                  />
                </div>
                
                <div className="col-span-2 mt-4 pt-4 border-t">
                  <h4 className="text-sm font-medium mb-4">Generation Defaults</h4>
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
                <div className="space-y-2">
                  <Label>Timeout (ms)</Label>
                  <Input 
                    type="number" 
                    value={formData.timeout_ms} 
                    onChange={e => setFormData({...formData, timeout_ms: parseInt(e.target.value)})} 
                  />
                </div>
                <div className="space-y-2">
                  <Label>Retry Count</Label>
                  <Input 
                    type="number" 
                    value={formData.retry_count} 
                    onChange={e => setFormData({...formData, retry_count: parseInt(e.target.value)})} 
                  />
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProviderOpen(false)}>Cancel</Button>
              <Button type="submit">Save Provider</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
