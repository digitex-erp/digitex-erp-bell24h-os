import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Command, AlertCircle, Loader2 } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation, useNavigate, Link, Navigate } from "react-router-dom";
import { supabase, SUPABASE_CONFIGURED, supabaseProjectId, isInitialUrlPasswordRecovery } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

export function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoadingAuth = useAuthStore((state) => state.isLoading);

  const [isLoading, setIsLoading] = useState(false);
  const [isVerifyingRecovery, setIsVerifyingRecovery] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | React.ReactNode | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isUpdatePasswordMode = location.pathname.includes("update-password");

  useEffect(() => {
    const handleRecovery = async () => {
      if (!isUpdatePasswordMode) return;

      const params = new URLSearchParams(location.search);
      const hash = new URLSearchParams(location.hash.substring(1));
      
      const type = params.get('type') || hash.get('type');
      const code = params.get('code');
      
      if (type === 'recovery' || code) {
        setIsVerifyingRecovery(true);
        console.log("[Runtime] Recovery link detected, verifying...");

        try {
          // DIAGNOSTIC GUARD: Supabase deliberately preserves an existing
          // session when a URL-based login fails to process (see
          // @supabase/auth-js GoTrueClient._initialize(): "Don't remove
          // existing session on URL login failure... shouldn't invalidate a
          // valid session"). Without this, a stale session already sitting in
          // this browser (from earlier activity, another account, or a
          // previous partially-completed flow) could satisfy the checks below
          // even if THIS link's own tokens were never actually exchanged —
          // and updateUser() would then silently mutate the wrong account.
          // Clearing local session state first guarantees that any session
          // found past this point was established by this link's own tokens.
          await supabase.auth.signOut({ scope: 'local' }).catch(() => {});

          if (code) {
            // PKCE Flow
            const { error } = await supabase.auth.exchangeCodeForSession(code);
            if (error) throw error;
            console.log("[Runtime] PKCE code exchanged for session successfully");
            // Small delay to let the store update
            await new Promise(resolve => setTimeout(resolve, 800));
          } else {
            // Implicit flow - supabase-js should have handled hash automatically
            // We retry a few times to see if the session populates
            let retries = 5;
            let currentSession = null;
            while (retries > 0 && !currentSession) {
              const { data } = await supabase.auth.getSession();
              currentSession = data.session;
              if (!currentSession) {
                await new Promise(resolve => setTimeout(resolve, 300));
                retries--;
              }
            }
            
            if (!currentSession) {
              throw new Error("Could not establish a recovery session from the link. The link may be expired or invalid.");
            }
            console.log("[Runtime] Implicit recovery session established");
          }
        } catch (err: any) {
          console.error("[Runtime] Recovery verification failed:", err);
          setError(
            <div className="space-y-2">
              <p className="font-bold">Recovery link verification failed.</p>
              <p className="text-xs">{err.message}</p>
              <Button variant="outline" size="sm" onClick={() => navigate("/auth/forgot-password")} className="mt-2">
                Request New Link
              </Button>
            </div>
          );
        } finally {
          setIsVerifyingRecovery(false);
        }
      }
    };

    handleRecovery();
  }, [isUpdatePasswordMode, location, navigate]);

  if (isLoadingAuth || isVerifyingRecovery) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="h-12 w-12 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">
            {isVerifyingRecovery ? "Verifying recovery link..." : "Verifying session..."}
          </p>
        </div>
      </div>
    );
  }

  if (!isLoadingAuth && isAuthenticated && !isUpdatePasswordMode) {
    return <Navigate to="/dashboard" replace />;
  }

  // Handle case where session is missing for password update
  if (!isLoadingAuth && isUpdatePasswordMode && !isAuthenticated && !isVerifyingRecovery) {
    // Check if there are ANY recovery tokens in the URL before showing the hard error
    const params = new URLSearchParams(location.search);
    const hash = new URLSearchParams(location.hash.substring(1));
    const hasRecoveryToken = isInitialUrlPasswordRecovery || params.get('type') === 'recovery' || hash.get('type') === 'recovery' || params.has('code');

    if (!hasRecoveryToken) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <Card className="w-full max-w-sm border-amber-500/20 bg-amber-500/5">
            <CardContent className="pt-6 space-y-4">
              <div className="text-center space-y-2">
                <div className="flex justify-center">
                  <AlertCircle className="h-12 w-12 text-amber-500" />
                </div>
                <h1 className="text-xl font-bold">Action Required</h1>
                <p className="text-sm text-muted-foreground">
                  This page must be opened from a password reset email link.
                </p>
              </div>
              <Button className="w-full" variant="outline" onClick={() => navigate("/auth/forgot-password")}>
                Request Reset Link
              </Button>
              <Button className="w-full" variant="ghost" onClick={() => navigate("/auth/login")}>
                Back to Sign In
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }
  }

  const mode = location.pathname.includes("signup")
    ? "signup"
    : location.pathname.includes("forgot-password")
    ? "forgot-password"
    : isUpdatePasswordMode
    ? "update-password"
    : "login";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      if (!SUPABASE_CONFIGURED) {
        throw new Error("Supabase is not configured. Please check /system/diagnostics and ensure VITE_SUPABASE_URL and VITE_SUPABASE_KEY are added to your AI Studio Secrets panel.");
      }

      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        }).catch(err => ({ error: err }));
        
        if (error) {
          console.error("[Runtime] Sign-in error:", error);
          // Standard Supabase error message for unconfirmed email is generic for security
          // but sometimes it returns a specific error or the user sees it in logs.
          // We provide a helpful hint if they are stuck with 'Invalid login credentials'
          if (error.message === 'Email not confirmed' || error.message.toLowerCase().includes('confirm')) {
            throw new Error("Email not confirmed. Please check your inbox or disable 'Confirm Email' in Supabase Auth settings.");
          }
          throw error;
        }
        navigate("/dashboard");
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        }).catch(err => ({ error: err }));
        if (error) {
          console.error("[Runtime] Sign-up error detail:", error);
          throw error;
        }
        setSuccess("Check your email to verify your account.");
      } else if (mode === "forgot-password") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/update-password`,
        }).catch(err => ({ error: err }));
        if (error) throw error;
        setSuccess("Password reset email sent.");
      } else if (mode === "update-password") {
        // DIAGNOSTIC CHECKPOINT: getUser() makes a fresh round-trip to
        // Supabase's /auth/v1/user endpoint (unlike getSession(), which can
        // return cached local state) — this confirms, right before the
        // mutation, exactly which account's session is about to be changed.
        // Note: a Supabase implicit recovery link never includes the target
        // email in the URL (only tokens), so there is no independent
        // "expected email" in this app to compare against — this logs and
        // surfaces the actual identity instead, which is both the honest
        // option and the directly useful one for diagnosis.
        const { data: activeUser, error: getUserError } = await supabase.auth.getUser();
        console.log("[Runtime][Recovery] Active session immediately before updateUser():", {
          id: activeUser?.user?.id ?? null,
          email: activeUser?.user?.email ?? null,
          getUserError: getUserError?.message ?? null,
        });

        if (getUserError || !activeUser?.user) {
          throw new Error("Auth session missing!");
        }

        const { error } = await supabase.auth.updateUser({
          password: newPassword
        }).catch(err => ({ error: err }));
        if (error) {
          console.error("[Runtime][Recovery] updateUser() FAILED for:", {
            id: activeUser.user.id,
            email: activeUser.user.email,
            error: error.message,
          });
          throw error;
        }
        console.log("[Runtime][Recovery] updateUser() succeeded for:", {
          id: activeUser.user.id,
          email: activeUser.user.email,
        });
        setSuccess(`Password updated successfully for ${activeUser.user.email}. You can now login.`);
        setTimeout(() => navigate("/auth/login"), 2000);
      }
    } catch (err: any) {
      if (err.message === 'Auth session missing!') {
        setError(
          <div className="space-y-2">
            <p className="font-bold">Authentication session expired.</p>
            <p>The temporary session from your reset link has expired. Please request a new password reset email.</p>
            <Button variant="outline" size="sm" onClick={() => navigate("/auth/forgot-password")} className="mt-2">
              Request New Link
            </Button>
          </div>
        );
      } else if (err.message === 'Invalid login credentials') {
        setError(
          <div className="space-y-2">
            <p className="font-bold text-destructive">Invalid login credentials.</p>
            <p>Potential causes and solutions:</p>
            <ul className="list-disc pl-4 text-xs space-y-2">
              <li><strong>Missing User</strong>: Check the <Link to="/system/diagnostics" className="underline font-bold">Diagnostics Dashboard</Link>. Verify "auth.users count" and "Direct DB Connection". If you just reset your database, you must <Link to="/auth/signup" className="underline font-bold">Sign Up again</Link>.</li>
              <li><strong>Unverified Email</strong>: If you signed up, check your inbox. You can disable "Confirm Email" in Supabase &rarr; Authentication &rarr; Providers &rarr; Email.</li>
              <li><strong>Wrong Password</strong>: Use the <Link to="/auth/forgot-password" title="Forgot Password" className="underline font-bold">Forgot Password</Link> link below.</li>
            </ul>
          </div>
        );
      } else {
        setError(err.message || "An error occurred");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center space-y-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground mb-2">
            <Command className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Bell24h-OS</h1>
          <p className="text-sm text-muted-foreground">
            {mode === "login" && "Enter your credentials to access the platform"}
            {mode === "signup" && "Create a new account"}
            {mode === "forgot-password" && "Reset your password"}
            {mode === "update-password" && "Enter your new password"}
          </p>
        </div>
        <Card>
          <form onSubmit={handleSubmit}>
            <CardContent className="space-y-4 pt-6">
              {error && (
                <div className="p-3 text-sm rounded-md bg-destructive/10 text-destructive border border-destructive/20">
                  {error}
                </div>
              )}
              {success && (
                <div className="p-3 text-sm rounded-md bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                  {success}
                </div>
              )}
              
              {mode !== "update-password" && (
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input 
                    id="email" 
                    type="email" 
                    placeholder="name@example.com" 
                    required 
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              )}

              {mode === "update-password" && (
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <Input 
                    id="new-password" 
                    type="password" 
                    required 
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
              )}
              
              {mode !== "forgot-password" && mode !== "update-password" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    {mode === "login" && (
                      <Link to="/auth/forgot-password" className="text-xs text-primary hover:underline">
                        Forgot password?
                      </Link>
                    )}
                  </div>
                  <Input 
                    id="password" 
                    type="password" 
                    required 
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              )}
            </CardContent>
            <CardFooter className="flex-col gap-4">
              <Button className="w-full" type="submit" disabled={isLoading}>
                {isLoading ? "Processing..." : mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : mode === "forgot-password" ? "Send reset link" : "Update password"}
              </Button>
              
              <div className="text-center text-sm text-muted-foreground w-full">
                {mode === "login" ? (
                  <>
                    Don't have an account?{" "}
                    <Link to="/auth/signup" className="text-primary hover:underline">
                      Sign up
                    </Link>
                  </>
                ) : (
                  <>
                    Back to{" "}
                    <Link to="/auth/login" className="text-primary hover:underline">
                      Sign in
                    </Link>
                  </>
                )}
              </div>
            </CardFooter>
          </form>
        </Card>
        <div className="text-center text-sm text-muted-foreground">
          By continuing, you agree to our{" "}
          <a href="#" className="underline hover:text-primary">
            Terms of Service
          </a>{" "}
          and{" "}
          <a href="#" className="underline hover:text-primary">
            Privacy Policy
          </a>.
        </div>
      </div>
    </div>
  );
}
