---
name: avito
description: Manage Avito business workflows through the `avito-py` Python SDK from `p141592/avito_python_api`. Use when Codex needs to analyze Avito listings, paid promotion, chats, calls, CPA leads, orders, delivery, labels, stock, reviews, ratings, realty pricing/bookings, jobs/vacancies/applications/resumes, account balance, employees, phones, tariffs, or Autoload diagnostics.
---

# Avito Business

Use this skill to turn an Avito business goal into a safe `avito-py` workflow: read data, diagnose the business situation, recommend actions, and only execute risky operations after explicit user confirmation.

## Core Rules

- Use only `avito-py` from `p141592/avito_python_api`: https://p141592.github.io/avito_python_api/.
- Use `avito.AvitoClient` and SDK configuration from environment, preferably `AvitoClient.from_env()`.
- Do not use other SDKs, unofficial wrappers, scraping, browser automation, or direct HTTP unless `avito-py` lacks the required operation and the user explicitly approves the fallback.
- Use final domain methods from `avito-py` directly. Do not recreate missing SDK workflows with custom aggregation, parsing, scoring, or business heuristics.
- If `avito-py` lacks a final method for the requested report or action, return the required SDK/API improvements instead of implementing the missing logic locally.
- Default to read/report/preview mode.
- Never expose tokens, client secrets, refresh tokens, authorization headers, or raw credential-bearing errors.

## Workflow

1. Identify the user's business goal: diagnose, compare, recommend, preview, or execute.
2. Identify scope: account, user, item IDs, order IDs, chat IDs, date range, category, employee, or workflow domain.
3. Read relevant data first through `AvitoClient` domain objects.
4. Compute a business diagnosis using account-relative baselines where possible.
5. Present recommended actions with reason, expected impact, required data, and risk.
6. Require explicit confirmation before paid, write, destructive, or reputation-affecting operations.

## Reference Navigation

- Read [references/sdk-domain-map.md](references/sdk-domain-map.md) when mapping a business request to `avito-py` domains and methods.
- Read [references/business-scenarios.md](references/business-scenarios.md) for workflow patterns and expected business outputs.
- Read [references/decision-rules.md](references/decision-rules.md) when turning metrics into recommendations.
- Read [references/safety.md](references/safety.md) before any paid, write, destructive, or reputation-affecting action.

## Bundled Scripts

- `scripts/avito_smoke_check.py`: verify import, client configuration, auth, current account, and optional balance without printing secrets.
- `scripts/listing_health_report.py`: generate a read-only JSON or CSV listing health report.
- `scripts/promotion_decision_preview.py`: preview promotion recommendations for item IDs without buying promotion.

Run scripts with `--help` first when unsure about parameters.
