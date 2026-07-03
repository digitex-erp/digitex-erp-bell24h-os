import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Command } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate, Link, Navigate } from "react-router-dom";
import { supabase, SUPABASE_CONFIGURED } from "@/lib/supabase";
import { useAuthStore } from "@/store/useAuthStore";

export function AuthPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoadingAuth = useAuthStore((state) => state.isLoading);

  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  if (!isLoadingAuth && isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  const mode = location.pathname.includes("signup")
    ? "signup"
    : location.pathname.includes("forgot-password")
    ? "forgot-password"
    : "login";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setSuccess(null);
    
    try {
      if (!SUPABASE_CONFIGURED) {
        throw new Error("Supabase is not configured. Please add SUPABASE_URL and SUPABASE_KEY to your AI Studio Secrets panel.");
      }

      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate("/dashboard");
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
        });
        if (error) throw error;
        setSuccess("Check your email to verify your account.");
      } else if (mode === "forgot-password") {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/update-password`,
        });
        if (error) throw error;
        setSuccess("Password reset email sent.");
      }
    } catch (err: any) {
      setError(err.message || "An error occurred");
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
              
              {mode !== "forgot-password" && (
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
                {isLoading ? "Processing..." : mode === "login" ? "Sign in" : mode === "signup" ? "Create account" : "Send reset link"}
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
