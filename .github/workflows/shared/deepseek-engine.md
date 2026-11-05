---
# Shared DeepSeek engine and budget for agentic workflows. Permissions, network,
# tools, Safe Outputs, prompts, and verdict jobs stay with each workflow.
engine:
  id: copilot
  env:
    COPILOT_PROVIDER_BASE_URL: https://api.deepseek.com
    COPILOT_PROVIDER_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
    COPILOT_MODEL: deepseek-flash

sandbox:
  agent:
    # Keep AWF from rewriting the model name through its built-in catalog.
    model-fallback: false

# The AWF API proxy prices every request to enforce max-ai-credits. deepseek-flash
# is not in its built-in table, so a fallback rate is mandatory (without it the
# proxy rejects the request with HTTP 400 before it reaches DeepSeek). These are
# DeepSeek V4.1-Flash peak rates in USD per 1M tokens, so AIC over-estimates
# off-peak usage rather than under-estimating it.
models:
  default-ai-credits-pricing:
    input: 0.3
    output: 1.2
    cache_read: 0.006

# Budget guardrails. `max-ai-credits` is enforced by the API proxy per run (it
# prices every request) and skips the rest of a run when hit. `max-daily-ai-credits`
# is configured but inert for this BYOK model: gh-aw v0.88.7's activation guardrail
# computes zero AI credits for these runs, verified on the drill PR #46 where the
# agent ran with the cap set to 1. Do not rely on the daily cap; the per-run
# cap is the only effective budget guard for this engine.
max-ai-credits: 300
max-daily-ai-credits: 2000
---
