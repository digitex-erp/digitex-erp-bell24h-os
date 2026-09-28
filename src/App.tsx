/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";
import { DashboardPage } from "@/pages/DashboardPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { AdminPage } from "@/pages/AdminPage";
import { DatabasePage } from "@/pages/DatabasePage";
import { AuthPage } from "@/pages/AuthPage";
import { useAuthStore } from "@/store/useAuthStore";
import { useAuth } from "@/hooks/useAuth";

import { OrganizationPage } from "@/pages/OrganizationPage";
import { TeamPage } from "@/pages/TeamPage";
import { AiProvidersPage } from "@/pages/AiProvidersPage";
import { AiRouterDashboardPage } from "@/pages/AiRouterDashboardPage";
import { PromptStudioPage } from "@/pages/PromptStudioPage";
import { ContentPlannerPage } from "@/pages/ContentPlannerPage";
import { ImageStudioPage } from "@/pages/ImageStudioPage";
import { VideoStudioPage } from "@/pages/VideoStudioPage";
import { JobOrchestratorPage } from "@/pages/JobOrchestratorPage";
import { ContextProfileManagerPage } from "@/pages/ContextProfileManagerPage";
import { SeoDashboardPage } from "@/pages/SeoDashboardPage";
import { SeoCenterPage } from "@/pages/SeoCenterPage";
import { CampaignDashboardPage } from "@/pages/CampaignDashboardPage";
import { CampaignBuilderPage } from "@/pages/CampaignBuilderPage";
import { MediaComposerDashboardPage } from "@/pages/MediaComposerDashboardPage";
import { PublishingCenterPage } from "@/pages/PublishingCenterPage";
import { AutomationDashboardPage } from "@/pages/AutomationDashboardPage";
import { AutomationBuilderPage } from "@/pages/AutomationBuilderPage";
import { PerformanceDashboardPage } from "@/pages/PerformanceDashboardPage";
import { SystemDiagnosticsPage } from "@/pages/SystemDiagnosticsPage";
import { KnowledgeVaultPage } from "@/pages/KnowledgeVaultPage";
import { IndustryDashboardPage } from "@/pages/IndustryDashboardPage";
import { AdminCommunicationsPage } from "@/pages/AdminCommunicationsPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  
  if (isLoading) {
    return <div className="flex h-screen items-center justify-center text-foreground bg-background">Loading...</div>;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}

function AuthRedirect({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  // Initialize auth listener
  useAuth();
  
  return (
    <BrowserRouter>
      <Routes>
        {/* TEMPORARY DEVELOPMENT AUTH BYPASS: Redirecting auth routes to dashboard */}
        <Route path="/auth" element={<AuthRedirect><AuthPage /></AuthRedirect>} />
        <Route path="/auth/login" element={<AuthRedirect><AuthPage /></AuthRedirect>} />
        <Route path="/auth/signup" element={<AuthRedirect><AuthPage /></AuthRedirect>} />
        <Route path="/auth/forgot-password" element={<AuthRedirect><AuthPage /></AuthRedirect>} />
        <Route path="/auth/update-password" element={<AuthRedirect><AuthPage /></AuthRedirect>} />
        <Route path="/system/diagnostics" element={<SystemDiagnosticsPage />} />
        
        <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="knowledge-vault" element={<KnowledgeVaultPage />} />
          <Route path="organization" element={<OrganizationPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="ai-providers" element={<AiProvidersPage />} />
          <Route path="ai-router" element={<AiRouterDashboardPage />} />
          <Route path="prompt-studio" element={<PromptStudioPage />} />
          <Route path="content-planner" element={<ContentPlannerPage />} />
          <Route path="image-studio" element={<ImageStudioPage />} />
          <Route path="video-studio" element={<VideoStudioPage />} />
          <Route path="job-orchestrator" element={<JobOrchestratorPage />} />
          <Route path="context-profiles" element={<ContextProfileManagerPage />} />
          <Route path="seo" element={<SeoCenterPage />} />
          <Route path="seo/:subtab" element={<SeoCenterPage />} />
          <Route path="seo-intelligence" element={<Navigate to="/seo" replace />} />
          <Route path="seo-intelligence/:subtab" element={<Navigate to="/seo" replace />} />
          <Route path="campaigns" element={<CampaignDashboardPage />} />
          <Route path="campaigns/builder" element={<CampaignBuilderPage />} />
          <Route path="media-composer" element={<MediaComposerDashboardPage />} />
          <Route path="publishing-center" element={<PublishingCenterPage />} />
          <Route path="automation" element={<AutomationDashboardPage />} />
          <Route path="automation/builder" element={<AutomationBuilderPage />} />
          <Route path="performance-intelligence" element={<PerformanceDashboardPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="database" element={<DatabasePage />} />
          {/* BELL24H_OS_EXECUTION_BACKLOG.md TASK-08 (GOV-4): this page was fully
              built but never routed anywhere, making it unreachable even by
              direct URL. Routing it, not removing it, since the underlying
              service (IndustryIntelligenceService) is real. */}
          <Route path="industry-dashboard" element={<IndustryDashboardPage />} />
          <Route path="admin/communications" element={<AdminCommunicationsPage />} />
          {/* Old path (nav link, bookmarks) -> the console. */}
          <Route path="communications" element={<Navigate to="/admin/communications" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

