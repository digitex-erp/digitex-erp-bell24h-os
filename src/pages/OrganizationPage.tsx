import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Building2, MapPin, CreditCard, Settings2, Users } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

export function OrganizationPage() {
  const { user } = useAuthStore();
  const [org, setOrg] = useState<any>(null);
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchOrganization();
  }, [user]);

  async function fetchOrganization() {
    if (!user) return;
    try {
      // Get the profile to find org_id
      const { data: profile } = await supabase
        .from('profiles')
        .select('organization_id')
        .eq('id', user.id)
        .single();
        
      if (profile?.organization_id) {
        const { data: orgData } = await supabase
          .from('organizations')
          .select('*')
          .eq('id', profile.organization_id)
          .single();
          
        if (orgData) {
          if (!orgData.addresses) orgData.addresses = {};
          if (!orgData.settings) orgData.settings = {};
          setOrg(orgData);
          
          // Fetch members
          const { data: memberData } = await supabase
            .from('profiles')
            .select('id, email, first_name, last_name, is_active')
            .eq('organization_id', profile.organization_id);
            
          if (memberData) setMembers(memberData);
        }
      } else {
        // If user has no organization_id, we might need to handle it or create one.
        // For testing, let's say they have no organization yet.
        setOrg(null);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  const handleOrgUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!org?.id) return;
    setSaving(true);
    setMessage("");
    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          name: org.name,
          legal_name: org.legal_name,
          description: org.description,
          industry: org.industry,
          website: org.website,
          company_email: org.company_email,
          phone_number: org.phone_number,
          gst_number: org.gst_number,
          pan_number: org.pan_number,
          iec_number: org.iec_number,
          cin: org.cin,
          msme_number: org.msme_number,
          addresses: org.addresses,
          settings: org.settings,
          logo_url: org.logo_url
        })
        .eq('id', org.id);
        
      if (error) throw error;
      setMessage("Organization details updated successfully.");
    } catch (err: any) {
      setMessage("Error updating details: " + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      if (!e.target.files || e.target.files.length === 0) return;
      const file = e.target.files[0];
      const fileExt = file.name.split('.').pop();
      const fileName = `${org.id}-logo.${fileExt}`;
      const filePath = `${fileName}`;

      setSaving(true);
      
      const { error: uploadError } = await supabase.storage
        .from('organization-logos')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from('organization-logos').getPublicUrl(filePath);
      
      setOrg((prev: any) => ({ ...prev, logo_url: data.publicUrl }));
      setMessage("Logo uploaded successfully. Please save changes.");
    } catch (error: any) {
      setMessage("Error uploading logo: " + error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddressChange = (type: string, field: string, value: string) => {
    setOrg((prev: any) => ({
      ...prev,
      addresses: {
        ...prev.addresses,
        [type]: {
          ...(prev.addresses[type] || {}),
          [field]: value
        }
      }
    }));
  };

  const handleSettingChange = (field: string, value: any) => {
    setOrg((prev: any) => ({
      ...prev,
      settings: {
        ...prev.settings,
        [field]: value
      }
    }));
  };

  if (loading) {
    return <div className="p-8 text-center text-muted-foreground">Loading organization...</div>;
  }

  if (!org) {
    return (
      <div className="p-8 text-center max-w-lg mx-auto mt-20">
        <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-2xl font-bold mb-2">No Organization Found</h2>
        <p className="text-muted-foreground mb-6">
          You do not belong to any organization yet. Please contact your administrator to be invited, or create a new organization.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Organization</h1>
        <p className="text-muted-foreground">
          Manage your company profile, billing, and team members.
        </p>
      </div>
      
      {message && (
        <div className="p-4 bg-primary/10 text-primary border border-primary/20 rounded-md">
          {message}
        </div>
      )}
      
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full max-w-3xl grid-cols-5 mb-8">
          <TabsTrigger value="profile"><Building2 className="h-4 w-4 mr-2 hidden sm:block" /> Profile</TabsTrigger>
          <TabsTrigger value="addresses"><MapPin className="h-4 w-4 mr-2 hidden sm:block" /> Addresses</TabsTrigger>
          <TabsTrigger value="members"><Users className="h-4 w-4 mr-2 hidden sm:block" /> Members</TabsTrigger>
          <TabsTrigger value="subscription"><CreditCard className="h-4 w-4 mr-2 hidden sm:block" /> Subscription</TabsTrigger>
          <TabsTrigger value="settings"><Settings2 className="h-4 w-4 mr-2 hidden sm:block" /> Settings</TabsTrigger>
        </TabsList>
        
        <TabsContent value="profile" className="space-y-6">
          <Card>
            <form onSubmit={handleOrgUpdate}>
              <CardHeader>
                <CardTitle>Company Profile</CardTitle>
                <CardDescription>
                  Basic information about your organization.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center gap-6">
                  <div className="h-20 w-20 rounded-lg bg-muted flex items-center justify-center overflow-hidden border">
                    {org.logo_url ? (
                      <img src={org.logo_url} alt="Organization Logo" className="h-full w-full object-cover" />
                    ) : (
                      <Building2 className="h-8 w-8 text-muted-foreground" />
                    )}
                  </div>
                  <div>
                    <Label htmlFor="logo" className="cursor-pointer bg-secondary hover:bg-secondary/80 px-4 py-2 rounded-md inline-block text-sm font-medium transition-colors">
                      Upload Logo
                    </Label>
                    <input 
                      id="logo" 
                      type="file" 
                      accept="image/*" 
                      className="hidden" 
                      onChange={handleLogoUpload}
                      disabled={saving}
                    />
                    <p className="text-xs text-muted-foreground mt-2">Recommended: 400x400px. Max 2MB.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label htmlFor="name">Display Name</Label>
                    <Input 
                      id="name" 
                      value={org.name || ""} 
                      onChange={(e) => setOrg({...org, name: e.target.value})} 
                      required 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="legal_name">Legal Name</Label>
                    <Input 
                      id="legal_name" 
                      value={org.legal_name || ""} 
                      onChange={(e) => setOrg({...org, legal_name: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="description">Company Description</Label>
                    <Textarea 
                      id="description" 
                      value={org.description || ""} 
                      onChange={(e) => setOrg({...org, description: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="industry">Industry</Label>
                    <Input 
                      id="industry" 
                      value={org.industry || ""} 
                      onChange={(e) => setOrg({...org, industry: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="website">Website</Label>
                    <Input 
                      id="website" 
                      type="url"
                      value={org.website || ""} 
                      onChange={(e) => setOrg({...org, website: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="company_email">Company Email</Label>
                    <Input 
                      id="company_email" 
                      type="email"
                      value={org.company_email || ""} 
                      onChange={(e) => setOrg({...org, company_email: e.target.value})} 
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="phone_number">Phone Number</Label>
                    <Input 
                      id="phone_number" 
                      type="tel"
                      pattern="^\+?[0-9\s\-()]{10,15}$"
                      title="Enter a valid phone number (e.g. +91 9876543210)"
                      value={org.phone_number || ""} 
                      onChange={(e) => setOrg({...org, phone_number: e.target.value})} 
                    />
                  </div>
                </div>

                <div className="border-t pt-6 mt-6">
                  <h3 className="text-lg font-medium mb-4">Tax & Registration Details</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <Label htmlFor="gst_number">GST Number</Label>
                      <Input 
                        id="gst_number" 
                        pattern="^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$"
                        title="Enter a valid 15-character GSTIN (e.g. 22AAAAA0000A1Z5)"
                        value={org.gst_number || ""} 
                        onChange={(e) => setOrg({...org, gst_number: e.target.value})} 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="pan_number">PAN Number</Label>
                      <Input 
                        id="pan_number" 
                        pattern="^[A-Z]{5}[0-9]{4}[A-Z]{1}$"
                        title="Enter a valid 10-character PAN (e.g. ABCDE1234F)"
                        value={org.pan_number || ""} 
                        onChange={(e) => setOrg({...org, pan_number: e.target.value})} 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="iec_number">IEC Number</Label>
                      <Input 
                        id="iec_number" 
                        value={org.iec_number || ""} 
                        onChange={(e) => setOrg({...org, iec_number: e.target.value})} 
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="cin">CIN</Label>
                      <Input 
                        id="cin" 
                        value={org.cin || ""} 
                        onChange={(e) => setOrg({...org, cin: e.target.value})} 
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="msme_number">MSME Registration Number</Label>
                      <Input 
                        id="msme_number" 
                        value={org.msme_number || ""} 
                        onChange={(e) => setOrg({...org, msme_number: e.target.value})} 
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="border-t px-6 py-4">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </TabsContent>

        <TabsContent value="addresses" className="space-y-6">
          <form onSubmit={handleOrgUpdate}>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {['registered', 'billing', 'shipping'].map((type) => (
                <Card key={type}>
                  <CardHeader>
                    <CardTitle className="capitalize">{type} Address</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label>Street Address</Label>
                      <Textarea 
                        value={org.addresses[type]?.street || ""}
                        onChange={(e) => handleAddressChange(type, 'street', e.target.value)}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>City</Label>
                        <Input 
                          value={org.addresses[type]?.city || ""}
                          onChange={(e) => handleAddressChange(type, 'city', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>State</Label>
                        <Input 
                          value={org.addresses[type]?.state || ""}
                          onChange={(e) => handleAddressChange(type, 'state', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Pincode / Zip</Label>
                        <Input 
                          value={org.addresses[type]?.pincode || ""}
                          onChange={(e) => handleAddressChange(type, 'pincode', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Country</Label>
                        <Input 
                          value={org.addresses[type]?.country || ""}
                          onChange={(e) => handleAddressChange(type, 'country', e.target.value)}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <div className="mt-6">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save Addresses"}
              </Button>
            </div>
          </form>
        </TabsContent>

        <TabsContent value="members" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Team Members</CardTitle>
                <CardDescription>
                  Manage who has access to your organization.
                </CardDescription>
              </div>
              <Button>Invite Member</Button>
            </CardHeader>
            <CardContent>
              <div className="border rounded-md divide-y">
                {members.map(member => (
                  <div key={member.id} className="p-4 flex items-center justify-between hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                        {member.first_name ? member.first_name[0] : member.email[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium">{member.first_name} {member.last_name}</div>
                        <div className="text-sm text-muted-foreground">{member.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      {member.is_active ? (
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-emerald-500/10 text-emerald-500">
                          Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold bg-slate-500/10 text-slate-500">
                          Inactive
                        </span>
                      )}
                      <Button variant="ghost" size="sm">Manage</Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="subscription" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Subscription Plan</CardTitle>
              <CardDescription>
                Manage your billing and plan limits.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-6 border rounded-lg bg-card/50 gap-4">
                <div>
                  <h3 className="text-2xl font-bold uppercase">{org.plan || 'FREE'} PLAN</h3>
                  <p className="text-muted-foreground mt-1">
                    Your plan is currently active.
                  </p>
                </div>
                <Button variant="outline">Upgrade Plan</Button>
              </div>
              
              <div className="space-y-4">
                <h4 className="font-medium">Current Usage</h4>
                <div className="space-y-6">
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Users (3/5)</span>
                      <span className="text-muted-foreground">60%</span>
                    </div>
                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary w-[60%]" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span>Storage (2GB/10GB)</span>
                      <span className="text-muted-foreground">20%</span>
                    </div>
                    <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                      <div className="h-full bg-primary w-[20%]" />
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <Card>
            <form onSubmit={handleOrgUpdate}>
              <CardHeader>
                <CardTitle>Organization Settings</CardTitle>
                <CardDescription>
                  Configure regional and operational preferences.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>Timezone</Label>
                    <Select 
                      value={org.settings.timezone || "Asia/Kolkata"}
                      onValueChange={(val) => handleSettingChange('timezone', val)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select timezone" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Asia/Kolkata">IST (Asia/Kolkata)</SelectItem>
                        <SelectItem value="UTC">UTC</SelectItem>
                        <SelectItem value="America/New_York">EST (America/New_York)</SelectItem>
                        <SelectItem value="Europe/London">GMT (Europe/London)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Currency</Label>
                    <Select 
                      value={org.settings.currency || "INR"}
                      onValueChange={(val) => handleSettingChange('currency', val)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select currency" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="INR">INR (₹)</SelectItem>
                        <SelectItem value="USD">USD ($)</SelectItem>
                        <SelectItem value="EUR">EUR (€)</SelectItem>
                        <SelectItem value="GBP">GBP (£)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Date Format</Label>
                    <Select 
                      value={org.settings.dateFormat || "DD/MM/YYYY"}
                      onValueChange={(val) => handleSettingChange('dateFormat', val)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select date format" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                        <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                        <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="space-y-2">
                    <Label>Language</Label>
                    <Select 
                      value={org.settings.language || "en"}
                      onValueChange={(val) => handleSettingChange('language', val)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select language" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="hi">Hindi</SelectItem>
                        <SelectItem value="es">Spanish</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="pt-6 border-t space-y-4">
                  <h4 className="font-medium">Notification Preferences</h4>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between rounded-lg border p-4 bg-card/50">
                      <div className="space-y-0.5">
                        <Label>Email Notifications</Label>
                        <p className="text-sm text-muted-foreground">
                          Receive daily digests and important alerts.
                        </p>
                      </div>
                      <Switch 
                        checked={org.settings.emailNotifications !== false}
                        onCheckedChange={(val) => handleSettingChange('emailNotifications', val)}
                      />
                    </div>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="border-t px-6 py-4">
                <Button type="submit" disabled={saving}>
                  {saving ? "Saving..." : "Save Settings"}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
