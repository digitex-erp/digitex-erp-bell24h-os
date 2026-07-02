import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const users = [
  { id: "usr_1", name: "Alice Smith", email: "alice@acme.com", role: "ADMIN", status: "Active" },
  { id: "usr_2", name: "Bob Jones", email: "bob@acme.com", role: "MANAGER", status: "Active" },
  { id: "usr_3", name: "Charlie Day", email: "charlie@acme.com", role: "EDITOR", status: "Inactive" },
  { id: "usr_4", name: "Diana Prince", email: "diana@acme.com", role: "VIEWER", status: "Active" },
];

export function AdminPage() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Console</h1>
          <p className="text-muted-foreground">
            Manage system users, roles, and global configurations.
          </p>
        </div>
        <Button>Invite User</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>User Management</CardTitle>
          <CardDescription>
            A list of all users in your organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <div className="grid grid-cols-5 border-b bg-muted/50 p-4 text-sm font-medium">
              <div className="col-span-2">Name</div>
              <div>Role</div>
              <div>Status</div>
              <div className="text-right">Actions</div>
            </div>
            <div className="divide-y">
              {users.map((user) => (
                <div key={user.id} className="grid grid-cols-5 items-center p-4 text-sm">
                  <div className="col-span-2">
                    <p className="font-medium">{user.name}</p>
                    <p className="text-muted-foreground">{user.email}</p>
                  </div>
                  <div>
                    <Badge variant="outline">{user.role}</Badge>
                  </div>
                  <div>
                    <Badge variant={user.status === "Active" ? "default" : "secondary"}>
                      {user.status}
                    </Badge>
                  </div>
                  <div className="text-right">
                    <Button variant="ghost" size="sm">Edit</Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
      
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Audit Logs</CardTitle>
            <CardDescription>Recent system events.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Admin Login</span>
                <span>2 mins ago</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">API Key generated</span>
                <span>15 mins ago</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">AI Provider config updated</span>
                <span>1 hour ago</span>
              </div>
            </div>
            <Button variant="link" className="px-0 mt-4">View All Logs</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
