/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 
 * BELL24H-OS ENTERPRISE SEO CENTER v3.0 - REACT HOOK
 * Multi-tenant state management, real-time fetching, and CRUD mutations across all 12 modules.
 */

import { useState, useEffect, useCallback } from "react";
import { EnterpriseSeoService } from "@/modules/seo-intelligence/EnterpriseSeoService";
import type {
  SeoProject,
  KeywordCluster,
  SeoKeyword,
  SeoRanking,
  SeoAudit,
  SeoAuditIssue,
  SeoMetaTag,
  SeoSchema,
  SeoContentAnalysis,
  SeoContentBrief,
  SeoCompetitor,
  SeoContentGap,
  SeoBacklink,
  SeoLocalRanking,
  SeoGeoAudit,
  SeoRecommendation,
  SeoTask,
  SeoTrendPoint,
  SeoScorecard,
  SeoSitemap,
  SeoRedirect,
  SeoPagespeedReport,
  SeoAiVisibility,
  SeoCitation,
  SeoBrokenLink,
  SeoContentScore,
  SeoAlert,
  KeywordIntent,
  SchemaEntityType
} from "@/types/seo";

export function useEnterpriseSeo() {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Active Project & Projects
  const [projects, setProjects] = useState<SeoProject[]>([]);
  const [activeProject, setActiveProject] = useState<SeoProject | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // 12 Enterprise Sub-Module Data States
  const [keywords, setKeywords] = useState<SeoKeyword[]>([]);
  const [clusters, setClusters] = useState<KeywordCluster[]>([]);
  const [rankings, setRankings] = useState<SeoRanking[]>([]);
  const [siteAudits, setSiteAudits] = useState<SeoAudit[]>([]);
  const [issues, setIssues] = useState<SeoAuditIssue[]>([]);
  const [metaTags, setMetaTags] = useState<SeoMetaTag[]>([]);
  const [schemas, setSchemas] = useState<SeoSchema[]>([]);
  const [contentAnalysis, setContentAnalysis] = useState<SeoContentAnalysis[]>([]);
  const [contentScores, setContentScores] = useState<SeoContentScore[]>([]);
  const [briefs, setBriefs] = useState<SeoContentBrief[]>([]);
  const [competitors, setCompetitors] = useState<SeoCompetitor[]>([]);
  const [contentGaps, setContentGaps] = useState<SeoContentGap[]>([]);
  const [backlinks, setBacklinks] = useState<SeoBacklink[]>([]);
  const [brokenLinks, setBrokenLinks] = useState<SeoBrokenLink[]>([]);
  const [localRankings, setLocalRankings] = useState<SeoLocalRanking[]>([]);
  const [geoAudits, setGeoAudits] = useState<SeoGeoAudit[]>([]);
  const [tasks, setTasks] = useState<SeoTask[]>([]);
  const [alerts, setAlerts] = useState<SeoAlert[]>([]);
  const [recommendations, setRecommendations] = useState<SeoRecommendation[]>([]);
  const [scorecard, setScorecard] = useState<SeoScorecard | null>(null);
  const [trendPoints, setTrendPoints] = useState<SeoTrendPoint[]>([]);

  // Legacy compatibility states
  const [sitemaps, setSitemaps] = useState<SeoSitemap[]>([]);
  const [redirects, setRedirects] = useState<SeoRedirect[]>([]);
  const [pagespeed, setPagespeed] = useState<SeoPagespeedReport[]>([]);
  const [aiVisibility, setAiVisibility] = useState<SeoAiVisibility[]>([]);
  const [citations, setCitations] = useState<SeoCitation[]>([]);

  const service = EnterpriseSeoService.getInstance();

  // Load all data for active project
  const loadAllData = useCallback(async (forcedProjectId?: string) => {
    try {
      setLoading(true);
      setError(null);
      const projs = await service.getProjects();
      setProjects(projs);

      const effectiveId = forcedProjectId || activeProjectId || (projs[0] ? projs[0].id : null);
      const currentProj = projs.find(p => p.id === effectiveId) || projs[0] || null;
      setActiveProject(currentProj);
      if (currentProj && currentProj.id !== activeProjectId) {
        setActiveProjectId(currentProj.id);
      }

      if (currentProj) {
        const pId = currentProj.id;
        const [
          kws,
          cls,
          rnks,
          audits,
          iss,
          metas,
          schs,
          cas,
          cscores,
          brfs,
          comps,
          gaps,
          bls,
          blinks,
          locs,
          geos,
          tsks,
          alts,
          recs,
          score,
          trends,
          sms,
          reds,
          ps,
          aiVis,
          cits
        ] = await Promise.all([
          service.getKeywords(pId),
          service.getKeywordClusters(pId),
          service.getRankings(pId),
          service.getSiteAudits(pId),
          service.getIssues(pId),
          service.getMetaTags(pId),
          service.getSchemaMarkups(pId),
          service.getContentAnalysis(pId),
          service.getContentScores(pId),
          service.getContentBriefs(pId),
          service.getCompetitors(pId),
          service.getContentGaps(pId),
          service.getBacklinks(pId),
          service.getBrokenLinks(pId),
          service.getLocalRankings(pId),
          service.getGeoAudits(pId),
          service.getTasks(pId),
          service.getAlerts(pId),
          service.getRecommendations(pId),
          service.getScorecard(pId),
          service.getTrendHistory(pId),
          service.getSitemaps(pId),
          service.getRedirects(pId),
          service.getPageSpeed(pId),
          service.getAiVisibility(pId),
          service.getCitations(pId)
        ]);

        setKeywords(kws);
        setClusters(cls);
        setRankings(rnks);
        setSiteAudits(audits);
        setIssues(iss);
        setMetaTags(metas);
        setSchemas(schs);
        setContentAnalysis(cas);
        setContentScores(cscores);
        setBriefs(brfs);
        setCompetitors(comps);
        setContentGaps(gaps);
        setBacklinks(bls);
        setBrokenLinks(blinks);
        setLocalRankings(locs);
        setGeoAudits(geos);
        setTasks(tsks);
        setAlerts(alts);
        setRecommendations(recs);
        setScorecard(score);
        setTrendPoints(trends);
        setSitemaps(sms);
        setRedirects(reds);
        setPagespeed(ps);
        setAiVisibility(aiVis);
        setCitations(cits);
      }
    } catch (err: any) {
      console.error("[useEnterpriseSeo] Error loading SEO data:", err);
      setError(err.message || "Failed to load SEO Center data");
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    loadAllData();
  }, [loadAllData]);

  // Mutations & Actions
  const handleAddKeyword = async (keyword: string, intent?: KeywordIntent) => {
    if (!activeProject) return;
    const added = await service.addKeyword(activeProject.id, keyword, intent);
    setKeywords(prev => [added, ...prev]);
    const updatedScore = await service.getScorecard(activeProject.id);
    setScorecard(updatedScore);
    return added;
  };

  const handleBulkImportKeywords = async (rawKeywordsText: string) => {
    if (!activeProject) return [];
    const addedList = await service.bulkImportKeywords(activeProject.id, rawKeywordsText);
    setKeywords(prev => [...addedList, ...prev]);
    const updatedScore = await service.getScorecard(activeProject.id);
    setScorecard(updatedScore);
    return addedList;
  };

  const handleDeleteKeyword = async (id: string) => {
    await service.deleteKeyword(id);
    setKeywords(prev => prev.filter(k => k.id !== id));
  };

  const handleRunTechnicalAudit = async () => {
    if (!activeProject) return;
    const newAudit = await service.runTechnicalAudit(activeProject.id, `https://${activeProject.domain}`);
    setSiteAudits(prev => [newAudit, ...prev]);
    const newIssues = await service.getIssues(activeProject.id);
    setIssues(newIssues);
    const updatedScore = await service.getScorecard(activeProject.id);
    setScorecard(updatedScore);
    return newAudit;
  };

  const handleResolveIssue = async (id: string) => {
    await service.resolveIssue(id);
    setIssues(prev => prev.map(i => i.id === id ? { ...i, is_resolved: true } : i));
  };

  const handleSaveMetaTags = async (meta: Partial<SeoMetaTag>) => {
    if (!activeProject) return;
    const saved = await service.saveMetaTags(activeProject.id, meta);
    setMetaTags(prev => {
      const idx = prev.findIndex(m => m.id === saved.id || m.page_url === saved.page_url);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [saved, ...prev];
    });
    return saved;
  };

  const handleOptimizeMetaTagsAI = async (pageUrl: string, title: string, desc: string) => {
    if (!activeProject) return;
    return await service.optimizeMetaTagsAI(activeProject.id, pageUrl, title, desc);
  };

  const handleSaveSchema = async (entityType: SchemaEntityType, payload: Record<string, any>) => {
    if (!activeProject) return;
    const schemaJson = service.generateSchemaJson(entityType, payload);
    const saved = await service.saveSchemaMarkup(activeProject.id, entityType, schemaJson, payload.url);
    setSchemas(prev => [saved, ...prev]);
    return saved;
  };

  const handleGenerateBrief = async (topic: string, intent: KeywordIntent = 'Commercial') => {
    if (!activeProject) return;
    const newBrief = await service.generateContentBrief(activeProject.id, topic, intent);
    setBriefs(prev => [newBrief, ...prev]);
    return newBrief;
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

  const handleScanBrokenLinks = async () => {
    if (!activeProject) return;
    const result = await service.scanBrokenLinks(activeProject.id);
    const updated = await service.getBrokenLinks(activeProject.id);
    setBrokenLinks(updated);
    return result;
  };

  const handleResolveBrokenLink = async (linkId: string) => {
    await service.resolveBrokenLink(linkId);
    setBrokenLinks(prev => prev.map(l => l.id === linkId ? { ...l, is_resolved: true, resolved_at: new Date().toISOString() } : l));
  };

  const handleOptimizeContentAI = async (pageUrl: string) => {
    if (!activeProject) return;
    const result = await service.optimizeContentAI(activeProject.id, pageUrl);
    setContentScores(prev => {
      const idx = prev.findIndex(c => c.page_url === pageUrl);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = result;
        return next;
      }
      return [result, ...prev];
    });
    setContentAnalysis(prev => {
      const idx = prev.findIndex(c => c.page_url === pageUrl);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = result;
        return next;
      }
      return [result, ...prev];
    });
    return result;
  };

  const handleResolveAlert = async (alertId: string) => {
    await service.resolveAlert(alertId);
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, is_resolved: true, resolved_at: new Date().toISOString() } : a));
  };

  const handleRunGeoAudit = async (url?: string) => {
    if (!activeProject) return;
    const targetUrl = url || `https://${activeProject.domain}`;
    const newGeo = await service.runGeoAudit(activeProject.id, targetUrl);
    setGeoAudits(prev => [newGeo, ...prev]);
    return newGeo;
  };

  const handleCreateTask = async (task: Partial<SeoTask>) => {
    if (!activeProject) return;
    const newTask = await service.createTask(activeProject.id, task);
    setTasks(prev => [newTask, ...prev]);
    return newTask;
  };

  const handleRunTaskAction = async (taskId: string) => {
    return await service.runTaskAction(taskId);
  };

  const handleAskAgent = async (prompt: string, model?: string) => {
    return await service.askSeoAgent(prompt, model);
  };

  const handleAddRedirect = async (sourcePath: string, targetUrl: string, statusCode: 301 | 302 = 301) => {
    if (!activeProject) return;
    const added = await service.addRedirect(activeProject.id, sourcePath, targetUrl, statusCode);
    setRedirects(prev => [added, ...prev]);
    return added;
  };

  const handleSyncToCrm = async (data: { name: string; email: string; company: string; intentKeyword: string; value?: number }) => {
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
    clusters,
    rankings,
    siteAudits,
    issues,
    metaTags,
    schemas,
    contentAnalysis,
    contentScores,
    briefs,
    competitors,
    contentGaps,
    backlinks,
    brokenLinks,
    localRankings,
    geoAudits,
    tasks,
    alerts,
    recommendations,
    scorecard,
    trendPoints,
    sitemaps,
    redirects,
    pagespeed,
    aiVisibility,
    citations,
    refresh: loadAllData,
    handleAddKeyword,
    handleBulkImportKeywords,
    handleDeleteKeyword,
    handleRunTechnicalAudit,
    handleResolveIssue,
    handleSaveMetaTags,
    handleOptimizeMetaTagsAI,
    handleSaveSchema,
    handleGenerateBrief,
    handleAddCompetitor,
    handleAddBacklink,
    handleScanBrokenLinks,
    handleResolveBrokenLink,
    handleOptimizeContentAI,
    handleResolveAlert,
    handleRunGeoAudit,
    handleCreateTask,
    handleRunTaskAction,
    handleAskAgent,
    handleAddRedirect,
    handleSyncToCrm,
    handleSendToPlanner
  };
}
