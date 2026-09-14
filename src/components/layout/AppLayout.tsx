import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  Bell,
  Command,
  LayoutDashboard,
  Users,
  Database,
  Moon,
  Sun,
  Search,
  Check,
  ChevronsUpDown,
  LogOut,
  Building,
  BrainCircuit,
  TerminalSquare,
  FileText,
  Image as ImageIcon,
  Video as VideoIcon,
  Activity,
  Factory
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { supabase } from "@/lib/supabase";

const sidebarNavItems = [
  {
    title: "Knowledge Vault",
    href: "/knowledge-vault",
    icon: Database,
  },
  {
    title: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    title: "Organization",
    href: "/organization",
    icon: Building,
  },
  {
    title: "Team",
    href: "/team",
    icon: Users,
  },
  {
    title: "AI Providers",
    href: "/ai-providers",
    icon: BrainCircuit,
  },
  {
    title: "Prompt Studio",
    href: "/prompt-studio",
    icon: TerminalSquare,
  },
  {
    title: "Content Planner",
    href: "/content-planner",
    icon: FileText,
  },
  {
    title: "Image Studio",
    href: "/image-studio",
    icon: ImageIcon,
  },
  {
    title: "Video Studio",
    href: "/video-studio",
    icon: VideoIcon,
  },
  {
    title: "Job Orchestrator",
    href: "/job-orchestrator",
    icon: Activity,
  },
  {
    title: "Context Engine",
    href: "/context-profiles",
    icon: LayoutDashboard,
  },
  {
    title: "Industry Intelligence",
    href: "/industry-dashboard",
    icon: Factory,
  },
  // PHASE 4A blocker remediation (TASK-07 / GOV-3): "Admin" and "Settings" nav
  // entries removed — both pages presented fabricated data as real with no
  // backing service. Their <Route> entries in App.tsx are intentionally kept
  // (not deleted) so a direct URL now shows an honest "not implemented"
  // message instead of the previous mock content, or nothing.
  {
    title: "Database",
    href: "/database",
    icon: Database,
  },
  {
    title: "Diagnostics",
    href: "/system/diagnostics",
    icon: Activity,
  },
];

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const { user, logout } = useAuthStore();
  const [org, setOrg] = useState<any>(null);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  }, [theme]);

  useEffect(() => {
    async function fetchOrg() {
      if (!user) return;
      const { data: profile } = await supabase.from('profiles').select('organization_id').eq('id', user.id).single();
      if (profile?.organization_id) {
        const { data: orgData } = await supabase.from('organizations').select('id, name').eq('id', profile.organization_id).single();
        if (orgData) setOrg(orgData);
      }
    }
    fetchOrg();
  }, [user]);

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  const handleLogout = async () => {
    await supabase.auth.signOut();
    logout();
    navigate("/auth");
  };

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside className="hidden w-64 flex-col border-r bg-card/50 md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <div className="flex items-center gap-2 font-semibold tracking-tight">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Command className="h-5 w-5" />
            </div>
            Bell24h-OS
          </div>
        </div>

        {/* Workspace Switcher Placeholder */}
        <div className="p-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="w-full justify-between px-3">
                <div className="flex items-center gap-2">
                  <Avatar className="h-5 w-5">
                    <AvatarFallback>{org?.name ? org.name.substring(0,2).toUpperCase() : 'NO'}</AvatarFallback>
                  </Avatar>
                  <span className="truncate">{org?.name || "No Organization"}</span>
                </div>
                <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="start">
              <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <div className="flex items-center gap-2 w-full">
                  <Avatar className="h-5 w-5">
                    <AvatarFallback>{org?.name ? org.name.substring(0,2).toUpperCase() : 'NO'}</AvatarFallback>
                  </Avatar>
                  <span className="flex-1 truncate">{org?.name || "No Organization"}</span>
                  <Check className="h-4 w-4 opacity-50" />
                </div>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <span className="text-muted-foreground">+ Create Workspace</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-2">
          {sidebarNavItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "group flex items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground",
                location.pathname === item.href
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground"
              )}
            >
              <item.icon className="mr-2 h-4 w-4" />
              <span>{item.title}</span>
            </Link>
          ))}
        </nav>
        <div className="p-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm">
            <h4 className="mb-1 text-sm font-semibold tracking-tight">Enterprise Tier</h4>
            <p className="mb-3 text-xs text-muted-foreground">
              You are currently on the Enterprise billing tier.
            </p>
            <Button size="sm" className="w-full">
              View Usage
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex h-14 items-center justify-between border-b bg-card/50 px-4 lg:px-6">
          <div className="flex flex-1 items-center gap-4">
            <form className="hidden lg:flex w-full max-w-sm">
              <div className="relative w-full">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search globally..."
                  className="w-full bg-background pl-8 sm:w-[300px] md:w-[200px] lg:w-[300px]"
                />
              </div>
            </form>
          </div>
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground"
              onClick={toggleTheme}
            >
              {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              <span className="sr-only">Toggle theme</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="relative text-muted-foreground hover:text-foreground"
            >
              <Bell className="h-5 w-5" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-destructive"></span>
              <span className="sr-only">Notifications</span>
            </Button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Avatar className="h-8 w-8 cursor-pointer border border-border">
                  <AvatarImage src="https://github.com/shadcn.png" alt="@user" />
                  <AvatarFallback>{user?.name?.charAt(0) || "U"}</AvatarFallback>
                </Avatar>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user?.name || "User"}</p>
                    <p className="text-xs leading-none text-muted-foreground">{user?.email || "user@example.com"}</p>
                  </div>
                </DropdownMenuLabel>
                {/* PHASE 4A blocker remediation (TASK-07 / GOV-3): "Profile" and
                    "Settings" links removed from this dropdown — both pointed at
                    /settings, which has no real functionality behind it (see
                    SettingsPage.tsx). Removed here too, not just the sidebar,
                    since this was a second, separate navigation path to the
                    same non-functional page. */}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:bg-destructive/10 cursor-pointer">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-y-auto bg-background p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
