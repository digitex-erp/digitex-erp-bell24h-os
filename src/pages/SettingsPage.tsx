import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreditCard, Bell, User, Shield, Key, Puzzle } from "lucide-react";

export function SettingsPage() {
  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings, preferences, and integrations.
        </p>
      </div>
      
      <Tabs defaultValue="general" className="w-full">
        <TabsList className="grid w-full max-w-2xl grid-cols-6 mb-8">
          <TabsTrigger value="general"><User className="h-4 w-4 mr-2 hidden md:block" /> General</TabsTrigger>
          <TabsTrigger value="security"><Shield className="h-4 w-4 mr-2 hidden md:block" /> Security</TabsTrigger>
          <TabsTrigger value="providers"><Key className="h-4 w-4 mr-2 hidden md:block" /> AI Keys</TabsTrigger>
          <TabsTrigger value="notifications"><Bell className="h-4 w-4 mr-2 hidden md:block" /> Alerts</TabsTrigger>
          <TabsTrigger value="billing"><CreditCard className="h-4 w-4 mr-2 hidden md:block" /> Billing</TabsTrigger>
          <TabsTrigger value="integrations"><Puzzle className="h-4 w-4 mr-2 hidden md:block" /> Apps</TabsTrigger>
        </TabsList>
        
        <TabsContent value="general" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
              <CardDescription>
                Update your personal details and public profile.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="name">Display Name</Label>
                <Input id="name" defaultValue="John Doe" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" defaultValue="john.doe@example.com" />
              </div>
              <Button>Save Changes</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
              <CardDescription>
                Manage your password and 2FA settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="current-password">Current Password</Label>
                <Input id="current-password" type="password" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="new-password">New Password</Label>
                <Input id="new-password" type="password" />
              </div>
              <Button>Update Password</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="providers" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>AI Provider Configuration</CardTitle>
              <CardDescription>
                Configure API keys for the abstraction layer. Keys are stored securely and encrypted at rest.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2">
                <Label htmlFor="gemini">Gemini API Key</Label>
                <Input id="gemini" type="password" placeholder="AIzaSy..." defaultValue="*****************" />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="openai">OpenAI API Key</Label>
                <Input id="openai" type="password" placeholder="sk-..." />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="anthropic">Anthropic API Key</Label>
                <Input id="anthropic" type="password" placeholder="sk-ant-..." />
              </div>
              <Button variant="secondary">Update Keys</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>
                Configure how you receive alerts and system updates.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between space-x-2">
                <Label htmlFor="email-notifs" className="flex flex-col space-y-1">
                  <span>Email Notifications</span>
                  <span className="font-normal text-sm text-muted-foreground">Receive daily digests and critical alerts.</span>
                </Label>
                <Switch id="email-notifs" defaultChecked />
              </div>
              <div className="flex items-center justify-between space-x-2">
                <Label htmlFor="security-notifs" className="flex flex-col space-y-1">
                  <span>Security Alerts</span>
                  <span className="font-normal text-sm text-muted-foreground">Receive notifications about new logins.</span>
                </Label>
                <Switch id="security-notifs" defaultChecked />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Billing & Subscription</CardTitle>
              <CardDescription>
                Manage your billing information and view past invoices.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Stripe integration placeholder.</p>
              <Button className="mt-4" variant="outline">Manage Billing in Stripe</Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integrations" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Third-Party Integrations</CardTitle>
              <CardDescription>
                Connect external tools to Bell24h-OS.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">GitHub, Slack, Discord placeholders.</p>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
