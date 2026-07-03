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
import { PromptStudioPage } from "@/pages/PromptStudioPage";
import { ContentPlannerPage } from "@/pages/ContentPlannerPage";
import { ImageStudioPage } from "@/pages/ImageStudioPage";
import { VideoStudioPage } from "@/pages/VideoStudioPage";
import { JobOrchestratorPage } from "@/pages/JobOrchestratorPage";
import { ContextProfileManagerPage } from "@/pages/ContextProfileManagerPage";
import { SeoDashboardPage } from "@/pages/SeoDashboardPage";
import { CampaignDashboardPage } from "@/pages/CampaignDashboardPage";
import { CampaignBuilderPage } from "@/pages/CampaignBuilderPage";
import { MediaComposerDashboardPage } from "@/pages/MediaComposerDashboardPage";
import { PublishingCenterPage } from "@/pages/PublishingCenterPage";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const isLoading = useAuthStore((state) => state.isLoading);
  
  if (isLoading) {
    return <div className="flex h-screen items-center justify-center">Loading...</div>;
  }
  
  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  // Initialize auth listener
  useAuth();
  
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/auth/login" element={<AuthPage />} />
        <Route path="/auth/signup" element={<AuthPage />} />
        <Route path="/auth/forgot-password" element={<AuthPage />} />
        
        <Route path="/" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="organization" element={<OrganizationPage />} />
          <Route path="team" element={<TeamPage />} />
          <Route path="ai-providers" element={<AiProvidersPage />} />
          <Route path="prompt-studio" element={<PromptStudioPage />} />
          <Route path="content-planner" element={<ContentPlannerPage />} />
          <Route path="image-studio" element={<ImageStudioPage />} />
          <Route path="video-studio" element={<VideoStudioPage />} />
          <Route path="job-orchestrator" element={<JobOrchestratorPage />} />
          <Route path="context-profiles" element={<ContextProfileManagerPage />} />
          <Route path="seo-intelligence" element={<SeoDashboardPage />} />
          <Route path="campaigns" element={<CampaignDashboardPage />} />
          <Route path="campaigns/builder" element={<CampaignBuilderPage />} />
          <Route path="media-composer" element={<MediaComposerDashboardPage />} />
          <Route path="publishing-center" element={<PublishingCenterPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="admin" element={<AdminPage />} />
          <Route path="database" element={<DatabasePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

