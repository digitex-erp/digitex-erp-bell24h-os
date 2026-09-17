/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * BELL24H-OS ENTERPRISE SEO CENTER v2.0 - REACT HOOK
 * Encapsulates state management, real-time fetching, and CRUD mutations.
 */

import { useState, useEffect, useCallback } from "react";
import { EnterpriseSeoService } from "@/modules/seo-intelligence/EnterpriseSeoService";
import type {
  SeoProject,
  SeoKeyword,
  SeoCompetitor,
  SeoContentGap,
  SeoBacklink,
  SeoSiteAudit,
  SeoIssue,
  SeoSchemaMarkup,
  SeoSitemap,
  SeoRedirect,
  SeoMetaTag,
  SeoPagespeedReport,
  SeoAiVisibility,
  SeoCitation,
  SeoRecommendation,
  SeoScorecard,
  KeywordIntent,
  SchemaEntityType
} from "@/types/seo";

export function useEnterpriseSeo() {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Active Project & Projects
  const [projects, setProjects] = useState<SeoProject[]>([]);
  const [activeProject, setActiveProject] = useState<SeoProject | null>(null);

  // Sub-module data states
  const [keywords, setKeywords] = useState<SeoKeyword[]>([]);
  const [competitors, setCompetitors] = useState<SeoCompetitor[]>([]);
  const [contentGaps, setContentGaps] = useState<SeoContentGap[]>([]);
  const [backlinks, setBacklinks] = useState<SeoBacklink[]>([]);
  const [siteAudits, setSiteAudits] = useState<SeoSiteAudit[]>([]);
  const [issues, setIssues] = useState<SeoIssue[]>([]);
  const [schemas, setSchemas] = useState<SeoSchemaMarkup[]>([]);
  const [sitemaps, setSitemaps] = useState<SeoSitemap[]>([]);
  const [redirects, setRedirects] = useState<SeoRedirect[]>([]);
  const [metaTags, setMetaTags] = useState<SeoMetaTag[]>([]);
  const [pagespeed, setPagespeed] = useState<SeoPagespeedReport[]>([]);
  const [aiVisibility, setAiVisibility] = useState<SeoAiVisibility[]>([]);
  const [citations, setCitations] = useState<SeoCitation[]>([]);
  const [recommendations, setRecommendations] = useState<SeoRecommendation[]>([]);
  const [scorecard, setScorecard] = useState<SeoScorecard | null>(null);

  const service = EnterpriseSeoService.getInstance();

  // Load active project & all data
  const loadAllData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const projs = await service.getProjects();
      setProjects(projs);
      
      const currentProj = activeProject || projs[0] || null;
      setActiveProject(currentProj);

      if (currentProj) {
        const pId = currentProj.id;
        const [
          kws,
          comps,
          gaps,
          bls,
          audits,
          iss,
          schs,
          sms,
          reds,
          metas,
          ps,
          aiVis,
          cits,
          recs,
          score
        ] = await Promise.all([
          service.getKeywords(pId),
          service.getCompetitors(pId),
          service.getContentGaps(pId),
          service.getBacklinks(pId),
          service.getSiteAudits(pId),
          service.getIssues(pId),
          service.getSchemaMarkups(pId),
          service.getSitemaps(pId),
          service.getRedirects(pId),
          service.getMetaTags(pId),
          service.getPageSpeed(pId),
          service.getAiVisibility(pId),
          service.getCitations(pId),
          service.getRecommendations(pId),
          service.getScorecard(pId)
        ]);

        setKeywords(kws);
        setCompetitors(comps);
        setContentGaps(gaps);
        setBacklinks(bls);
        setSiteAudits(audits);
        setIssues(iss);
        setSchemas(schs);
        setSitemaps(sms);
        setRedirects(reds);
        setMetaTags(metas);
        setPagespeed(ps);
        setAiVisibility(aiVis);
        setCitations(cits);
        setRecommendations(recs);
        setScorecard(score);
      }
    } catch (err: any) {
      console.error("[useEnterpriseSeo] Error loading SEO data:", err);
      setError(err.message || "Failed to load SEO Center data");
    } finally {
      setLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Actions / Mutations
  const handleAddKeyword = async (keyword: string, intent?: KeywordIntent) => {
    if (!activeProject) return;
    const added = await service.addKeyword(activeProject.id, keyword, intent);
    setKeywords(prev => [added, ...prev]);
    const updatedScore = await service.getScorecard(activeProject.id);
    setScorecard(updatedScore);
    return added;
  };

  const handleDeleteKeyword = async (id: string) => {
    await service.deleteKeyword(id);
    setKeywords(prev => prev.filter(k => k.id !== id));
  };

  const handleAddCompetitor = async (domain: string, name: string) => {
    if (!activeProject) return;
    const added = await service.addCompetitor(activeProject.id, domain, name);
    setCompetitors(prev => [...prev, added]);
    return added;
  };

  const handleAddBacklink = async (sourceUrl: string, targetUrl: string, anchor: string) => {
    if (!activeProject) return;
    const added = await service.addBacklink(activeProject.id, sourceUrl, targetUrl, anchor);
    setBacklinks(prev => [added, ...prev]);
    return added;
  };

  const handleResolveIssue = async (id: string) => {
    await service.resolveIssue(id);
    setIssues(prev => prev.map(i => i.id === id ? { ...i, is_resolved: true } : i));
  };

  const handleSaveSchema = async (entityType: SchemaEntityType, payload: Record<string, any>) => {
    if (!activeProject) return;
    const schemaJson = service.generateSchemaJson(entityType, payload);
    const saved = await service.saveSchemaMarkup(activeProject.id, entityType, schemaJson, payload.url);
    setSchemas(prev => [saved, ...prev]);
    return saved;
  };

  const handleAddRedirect = async (sourcePath: string, targetUrl: string, statusCode: 301 | 302 = 301) => {
    if (!activeProject) return;
    const added = await service.addRedirect(activeProject.id, sourcePath, targetUrl, statusCode);
    setRedirects(prev => [added, ...prev]);
    return added;
  };

  const handleSyncToCrm = async (data: { name: string; email: string; company: string; intentKeyword: string }) => {
    return await service.syncLeadToCrm(data);
  };

  const handleSendToPlanner = async (keyword: string, intent: string) => {
    return await service.sendToContentPlanner(keyword, intent);
  };

  return {
    loading,
    error,
    projects,
    activeProject,
    setActiveProject,
    keywords,
    competitors,
    contentGaps,
    backlinks,
    siteAudits,
    issues,
    schemas,
    sitemaps,
    redirects,
    metaTags,
    pagespeed,
    aiVisibility,
    citations,
    recommendations,
    scorecard,
    refresh: loadAllData,
    handleAddKeyword,
    handleDeleteKeyword,
    handleAddCompetitor,
    handleAddBacklink,
    handleResolveIssue,
    handleSaveSchema,
    handleAddRedirect,
    handleSyncToCrm,
    handleSendToPlanner
  };
}
