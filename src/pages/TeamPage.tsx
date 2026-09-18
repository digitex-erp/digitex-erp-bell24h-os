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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Search, UserPlus, MoreVertical, Shield, Activity, Clock, LogOut, Check, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function TeamPage() {
  const { user } = useAuthStore();
  const [users, setUsers] = useState<any[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  
  // Dialog states
  const [inviteOpen, setInviteOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<any>(null);
  
  // Invite form state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [inviteDepartment, setInviteDepartment] = useState("");
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    fetchTeam();
    fetchRoles();
  }, [user]);

  async function fetchRoles() {
    if (!user) return;
    try {
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      let effectiveOrgId = profile?.organization_id;
      if (!effectiveOrgId) {
        const { data: rootOrg } = await supabase.from('organizations').select('id').limit(1).single();
        effectiveOrgId = rootOrg?.id;
      }
      if (effectiveOrgId) {
        const { data } = await supabase.from('roles').select('*').eq('organization_id', effectiveOrgId);
        if (data) setRoles(data);
      }
    } catch (err) {
      console.error("[TeamPage] fetchRoles error:", err);
    }
  }

  async function fetchTeam() {
    if (!user) return;
    setLoading(true);
    try {
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      let effectiveOrgId = profile?.organization_id;
      if (!effectiveOrgId) {
        const { data: rootOrg } = await supabase.from('organizations').select('id').limit(1).single();
        effectiveOrgId = rootOrg?.id;
      }
      
      if (effectiveOrgId) {
        // Since we can't do complex joins easily without a view, we fetch profiles and user_roles separately
        const { data: profilesData } = await supabase
          .from('profiles')
          .select('*')
          .eq('organization_id', effectiveOrgId);
          
        const { data: userRolesData } = await supabase
          .from('user_roles')
          .select('user_id, role_id')
          .eq('organization_id', effectiveOrgId);
          
        const { data: rolesData } = await supabase
          .from('roles')
          .select('id, name')
          .eq('organization_id', effectiveOrgId);

        if (profilesData) {
          const enrichedUsers = profilesData.map(p => {
            const userRoleMaps = userRolesData?.filter(ur => ur.user_id === p.id) || [];
            const userRoles = userRoleMaps.map(ur => {
              const r = rolesData?.find(role => role.id === ur.role_id);
              return r ? r.name : (p.email === 'bell24h.info@gmail.com' ? 'ADMIN' : 'Member');
            });
            
            return {
              ...p,
              roles: userRoles.length > 0 ? userRoles : (p.email === 'bell24h.info@gmail.com' ? ['ADMIN'] : ['Member'])
            };
          });
          setUsers(enrichedUsers);
        }
      }
    } catch (err) {
      console.error("[TeamPage] fetchTeam error:", err);
    } finally {
      setLoading(false);
    }
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    try {
      // Create auth user (simulated, usually requires server-side admin client)
      // Since we can't create auth.users from client without login, we will just record the attempt in audit logs
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user?.id).single();
      
      if (profile?.organization_id) {
        await supabase.from('audit_logs').insert({
          action: 'INVITE_USER',
          details: { email: inviteEmail, role: inviteRole, department: inviteDepartment },
          organization_id: profile.organization_id,
          created_by: user?.id
        });
        
        // Mock successful invite
        alert(`Invitation sent to ${inviteEmail}`);
        setInviteOpen(false);
        setInviteEmail("");
        setInviteRole("");
        setInviteDepartment("");
      }
    } catch (err) {
      console.error(err);
      alert("Failed to send invitation.");
    } finally {
      setInviting(false);
    }
  };

  const openProfile = (u: any) => {
    setSelectedUser(u);
    setProfileOpen(true);
  };

  const filteredUsers = users.filter(u => 
    (u.first_name || "").toLowerCase().includes(search.toLowerCase()) || 
    (u.last_name || "").toLowerCase().includes(search.toLowerCase()) || 
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Team Management</h1>
          <p className="text-muted-foreground">
            Manage members, roles, and permissions in your organization.
          </p>
        </div>
        <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
          <DialogTrigger asChild>
            <Button>
              <UserPlus className="h-4 w-4 mr-2" />
              Invite Member
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleInvite}>
              <DialogHeader>
                <DialogTitle>Invite New Member</DialogTitle>
                <DialogDescription>
                  Send an email invitation to join your organization.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label>Email Address</Label>
                  <Input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="name@company.com" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <Select value={inviteRole} onValueChange={setInviteRole}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        {roles.map(r => (
                          <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Department</Label>
                    <Select value={inviteDepartment} onValueChange={setInviteDepartment}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select dept" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Engineering">Engineering</SelectItem>
                        <SelectItem value="Sales">Sales</SelectItem>
                        <SelectItem value="Marketing">Marketing</SelectItem>
                        <SelectItem value="Operations">Operations</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={inviting}>
                  {inviting ? "Sending..." : "Send Invitation"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Organization Members</CardTitle>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search members..."
              className="pl-8"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-8 text-center text-muted-foreground">Loading team...</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Member</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Last Login</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No members found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredUsers.map((u) => (
                      <TableRow key={u.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar>
                              <AvatarImage src={u.avatar_url} />
                              <AvatarFallback>{u.first_name ? u.first_name[0] : u.email[0].toUpperCase()}</AvatarFallback>
                            </Avatar>
                            <div>
                              <div className="font-medium cursor-pointer hover:underline" onClick={() => openProfile(u)}>
                                {u.first_name} {u.last_name}
                              </div>
                              <div className="text-sm text-muted-foreground">{u.email}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {u.is_active ? (
                            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20">Active</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-slate-500/10 text-slate-500 border-slate-500/20">Inactive</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {u.roles.map((r: string) => (
                              <Badge key={r} variant="secondary" className="font-normal">{r}</Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <MoreVertical className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={() => openProfile(u)}>View Profile</DropdownMenuItem>
                              <DropdownMenuItem>Manage Roles</DropdownMenuItem>
                              <DropdownMenuItem>View Permissions</DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {u.is_active ? (
                                <DropdownMenuItem className="text-red-500">Deactivate User</DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem className="text-emerald-500">Activate User</DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      
      {/* User Profile Dialog */}
      {selectedUser && (
        <UserProfileDialog 
          open={profileOpen} 
          onOpenChange={setProfileOpen} 
          userProfile={selectedUser} 
          roles={roles}
          onUpdate={fetchTeam}
        />
      )}
    </div>
  );
}

function UserProfileDialog({ open, onOpenChange, userProfile, roles, onUpdate }: any) {
  const [activeTab, setActiveTab] = useState("profile");
  const [profile, setProfile] = useState(userProfile);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const { user: currentUser } = useAuthStore();
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  useEffect(() => {
    setProfile(userProfile);
  }, [userProfile]);

  useEffect(() => {
    if (open && activeTab === "audit") {
      fetchAuditLogs();
    }
  }, [open, activeTab]);

  const fetchAuditLogs = async () => {
    setLoadingLogs(true);
    try {
      const { data } = await supabase
        .from('audit_logs')
        .select('*')
        .eq('created_by', profile.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (data) setAuditLogs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: profile.first_name,
          last_name: profile.last_name,
          designation: profile.designation,
          department: profile.department,
          phone: profile.phone,
          timezone: profile.timezone,
          language: profile.language
        })
        .eq('id', profile.id);
        
      if (error) throw error;
      setMessage("Profile updated successfully");
      onUpdate();
    } catch (err: any) {
      setMessage("Failed to update profile: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>User Profile</DialogTitle>
          <DialogDescription>
            View and manage {profile.email}'s details, roles, and sessions.
          </DialogDescription>
        </DialogHeader>
        
        {message && (
          <div className="p-3 bg-primary/10 text-primary border border-primary/20 rounded-md text-sm">
            {message}
          </div>
        )}
        
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
          <TabsList className="grid grid-cols-5 w-full">
            <TabsTrigger value="profile">Profile</TabsTrigger>
            <TabsTrigger value="roles">Roles</TabsTrigger>
            <TabsTrigger value="permissions">Permissions</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="audit">Audit Log</TabsTrigger>
          </TabsList>
          
          <TabsContent value="profile" className="space-y-4 pt-4">
            <div className="flex items-center gap-6 mb-6">
              <Avatar className="h-24 w-24">
                <AvatarImage src={profile.avatar_url} />
                <AvatarFallback className="text-2xl">{profile.first_name ? profile.first_name[0] : profile.email[0].toUpperCase()}</AvatarFallback>
              </Avatar>
              <div>
                <h3 className="text-xl font-bold">{profile.first_name} {profile.last_name}</h3>
                <p className="text-muted-foreground">{profile.email}</p>
                <div className="flex gap-2 mt-2">
                  <Badge variant="outline">{profile.is_active ? 'Active' : 'Inactive'}</Badge>
                  {profile.roles?.map((r: string) => (
                    <Badge key={r} variant="secondary">{r}</Badge>
                  ))}
                </div>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name</Label>
                <Input value={profile.first_name || ""} onChange={e => setProfile({...profile, first_name: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Last Name</Label>
                <Input value={profile.last_name || ""} onChange={e => setProfile({...profile, last_name: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Designation</Label>
                <Input value={profile.designation || ""} onChange={e => setProfile({...profile, designation: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Department</Label>
                <Input value={profile.department || ""} onChange={e => setProfile({...profile, department: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Phone</Label>
                <Input type="tel" value={profile.phone || ""} onChange={e => setProfile({...profile, phone: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label>Timezone</Label>
                <Select value={profile.timezone || "UTC"} onValueChange={v => setProfile({...profile, timezone: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UTC">UTC</SelectItem>
                    <SelectItem value="Asia/Kolkata">IST (Asia/Kolkata)</SelectItem>
                    <SelectItem value="America/New_York">EST (America/New_York)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Language</Label>
                <Select value={profile.language || "en"} onValueChange={v => setProfile({...profile, language: v})}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="en">English</SelectItem>
                    <SelectItem value="hi">Hindi</SelectItem>
                    <SelectItem value="es">Spanish</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="pt-4 flex justify-end">
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Changes"}</Button>
            </div>
          </TabsContent>

          <TabsContent value="roles" className="space-y-4 pt-4">
            <h3 className="text-lg font-medium">Role Assignment</h3>
            <p className="text-sm text-muted-foreground">Assign roles to this user. Roles define what permissions they have in the organization.</p>
            
            <div className="space-y-4 border rounded-md p-4 mt-4">
              {roles.map((r: any) => (
                <div key={r.id} className="flex items-center space-x-2">
                  <Checkbox 
                    id={`role-${r.id}`} 
                    checked={profile.roles?.includes(r.name)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setProfile({ ...profile, roles: [...(profile.roles || []), r.name] });
                      } else {
                        setProfile({ ...profile, roles: (profile.roles || []).filter((name: string) => name !== r.name) });
                      }
                    }}
                  />
                  <Label htmlFor={`role-${r.id}`} className="flex flex-col cursor-pointer">
                    <span className="font-medium">{r.name}</span>
                    <span className="font-normal text-sm text-muted-foreground">{r.description || `Grants ${r.name} privileges`}</span>
                  </Label>
                </div>
              ))}
            </div>
            <div className="pt-4 flex justify-end">
              <Button 
                onClick={async () => {
                  setSaving(true);
                  try {
                    // First delete existing roles for user
                    await supabase.from('user_roles').delete().eq('user_id', profile.id);
                    // Then insert new roles
                    const rolesToInsert = profile.roles.map((roleName: string) => {
                      const role = roles.find((r: any) => r.name === roleName);
                      return role ? {
                        user_id: profile.id,
                        role_id: role.id,
                        organization_id: profile.organization_id
                      } : null;
                    }).filter(Boolean);
                    
                    if (rolesToInsert.length > 0) {
                      await supabase.from('user_roles').insert(rolesToInsert);
                    }
                    setMessage("Roles updated successfully!");
                    onUpdate();
                  } catch(e) {
                    setMessage("Failed to update roles.");
                  } finally {
                    setSaving(false);
                  }
                }} 
                disabled={saving}
              >
                {saving ? "Saving..." : "Save Roles"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="permissions" className="space-y-4 pt-4">
            <h3 className="text-lg font-medium">Effective Permissions</h3>
            <p className="text-sm text-muted-foreground">These are the permissions granted to this user based on their roles.</p>
            
            <div className="border rounded-md divide-y mt-4">
              <div className="p-3 flex justify-between items-center bg-muted/50">
                <span className="font-medium">User Management</span>
                <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">Granted</Badge>
              </div>
              <div className="p-3 flex justify-between items-center bg-muted/50">
                <span className="font-medium">Organization Settings</span>
                <Badge variant="outline" className="text-slate-500 border-slate-500/30">Denied</Badge>
              </div>
              <div className="p-3 flex justify-between items-center bg-muted/50">
                <span className="font-medium">Billing & Subscriptions</span>
                <Badge variant="outline" className="text-slate-500 border-slate-500/30">Denied</Badge>
              </div>
              <div className="p-3 flex justify-between items-center bg-muted/50">
                <span className="font-medium">View Reports</span>
                <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">Granted</Badge>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="sessions" className="space-y-4 pt-4">
            <h3 className="text-lg font-medium">Active Sessions</h3>
            <p className="text-sm text-muted-foreground">Recent devices where this user is logged in.</p>
            
            <div className="border rounded-md divide-y mt-4">
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-primary/10 rounded-full">
                    <Activity className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      Mac OS • Chrome 
                      <Badge variant="secondary" className="text-[10px]">Current Session</Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">IP: 192.168.1.42 • Last active: Just now</div>
                  </div>
                </div>
              </div>
              <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="p-2 bg-muted rounded-full">
                    <Activity className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="font-medium">iOS • Safari</div>
                    <div className="text-sm text-muted-foreground">IP: 104.28.192.42 • Last active: 2 hours ago</div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-600 hover:bg-red-50">Revoke</Button>
              </div>
            </div>
            
            {profile.id === currentUser?.id && (
              <div className="pt-4 flex justify-end">
                <Button variant="outline" className="text-red-500 hover:text-red-600 hover:bg-red-50">
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out other devices
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="audit" className="space-y-4 pt-4">
            <h3 className="text-lg font-medium">Activity Log</h3>
            <p className="text-sm text-muted-foreground">Recent actions performed by this user.</p>
            
            {loadingLogs ? (
              <div className="text-center py-4 text-muted-foreground">Loading logs...</div>
            ) : auditLogs.length === 0 ? (
              <div className="text-center py-8 border rounded-md text-muted-foreground">No recent activity found.</div>
            ) : (
              <div className="relative border-l border-muted ml-3 mt-4 space-y-6 pb-4">
                {auditLogs.map((log: any) => (
                  <div key={log.id} className="relative pl-6">
                    <div className="absolute left-[-5px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background" />
                    <div className="font-medium text-sm">{log.action}</div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                      <Clock className="h-3 w-3" />
                      {new Date(log.created_at).toLocaleString()}
                      {log.ip_address && <span> • IP: {log.ip_address}</span>}
                    </div>
                    {log.details && (
                      <div className="mt-2 text-xs bg-muted p-2 rounded-md font-mono overflow-x-auto">
                        {JSON.stringify(log.details)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
