# Bell24h-OS AI Router Policy

## Scope

All text, image, video, audio, OCR, embedding, and AI-assisted workflow requests must pass through the Enterprise AI Router.

## Provider routing

The router evaluates capability, policy, organization budget, provider health, latency, quality requirements, and cost. Open/self-hosted providers are preferred when they satisfy capability and policy requirements. Commercial providers are fallback-only unless an approved policy says otherwise.

## Open model policy

ComfyUI and approved local workers are the preferred integration boundary for open models such as Wan, LTX Video, CogVideoX, HunyuanVideo, Open-Sora, AnimateDiff, FLUX, SDXL, and Stable Diffusion. Model support must be represented as capability metadata and must not be claimed until an adapter and health test exist.

## Commercial model policy

Commercial providers such as Gemini, OpenAI, Anthropic, MiniMax, Kling, Veo, Runway, Luma, or Pika require explicit adapter support, credential isolation, cost metadata, rate limits, audit coverage, and fallback policy. The current repository contains direct provider implementations in `src/modules/ai-providers/AiProviderService.ts`; these are subject to migration behind the server/router boundary.

## Budgets and cost

Every request must be checked against platform, organization, user, and provider budgets where configured. Persist estimated and actual usage/cost, currency, provider, model, and billing period. Fail closed or queue for approval when a budget is exceeded.

## Retry and circuit breaker

Retry only transient failures with bounded exponential backoff and idempotency. Do not retry authorization, validation, or permanent capability failures. Open a circuit after a defined failure threshold and record recovery probes.

## Audit and telemetry

Record request ID, actor, organization, purpose, provider, model, route decision, fallback chain, latency, usage, cost, status, error class, and retry count. Redact prompt secrets and personal data.

## Current compliance note

The repository has an `AIManagerService`, provider classes, and request logging, but pages import the manager directly and provider calls use direct `fetch`. The policy is therefore normative and not yet fully satisfied by the current code.
