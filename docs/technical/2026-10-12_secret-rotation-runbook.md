# Secret rotation runbook

**Date:** 2026-10-12
**Trigger:** Audit finding S3 — live production secrets existed on disk in `.env` / `.env.local` (gitignored, but present). Gitignored is not protection: every developer machine, every backup of the repo directory, and any accidental copy of the tree is a full compromise surface.

## What automation did, and what only you can do

Automation added the guardrails: `.env.example` (the full variable list with placeholders), `tools/scan-secrets.mjs`, and a `.husky/pre-commit` hook that refuses a commit carrying a live-looking secret. It cannot rotate third-party credentials — those live behind provider dashboards. This is the manual part, in the order that minimizes downtime.

## Rotation order

Rotate in this sequence so the system is never left with a credential that is valid in one place and dead in another. For each: generate the new value in the provider's dashboard, update it wherever it is consumed, confirm the consumer works, then revoke the old value.

| # | Secret | Where to generate | Where to set | Rotation notes |
| --- | --- | --- | --- | --- |
| 1 | `DATABASE_URL` password | Neon console → Roles & databases → `neondb_owner` → Reset password | Vercel project env (`apps/web` project), local `.env.local`, Docker/TeamCity environments | Last in the "generate" step, because the app cannot serve without it: prepare the new value first, update the deployment env, redeploy, then reset in Neon. |
| 2 | `NEXTAUTH_SECRET` | generate locally: `openssl rand -base64 32` | Vercel env, local `.env.local` | Rotating invalidates every existing session cookie — users sign in again. That is the desired effect, not an outage. |
| 3 | `ENCRYPTION_KEY` | generate locally: `openssl rand -base64 32` | Vercel env, local `.env.local` | New since 2026-10-12. Absent means the app falls back to deriving from `NEXTAUTH_SECRET`, so rotating #2 without setting this keeps the fallback chain intact. |
| 4 | `PLATFORM_SESSION_SECRET` | generate locally: `openssl rand -base64 32` | Vercel env, local | Same session-invalidation effect as #2 for platform operators. |
| 5 | `RESEND_API_KEY` | Resend dashboard → API Keys | Vercel env, local | Create the new key, deploy, then delete the old one. |
| 6 | `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API | Vercel env, local | Service-role keys carry full data access; treat as the most sensitive item after #1. |
| 7 | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | AWS IAM → the project's user → Create access key | Vercel env, local, TeamCity | IAM allows two active keys per user: create the new one, deploy with it, then deactivate and delete the old. |
| 8 | MTN collection API credentials (`MTN_API_USER`, `MTN_API_KEY`, `MTN_SUBSCRIPTION_KEY`) | MTN MoMo developer portal → the product's credentials | Vercel env, local, TeamCity | Until these are set, mobile-money verification **fails closed to PENDING** by design — an unverified payment never settles. That is safe, not broken. |
| 9 | Seeded/demo passwords (`SEED_*`, `PLATFORM_OPERATOR_PASSWORD`) | choose locally | local only (seeding) | Development-only; production seeds must use unique values, never the examples in `.env.example`. |

## After rotating

1. Delete the old `.env` / `.env.local` and recreate from the template, so no stale value survives on disk:
   ```sh
   cp .env.example .env.local   # then fill the new values
   ```
2. Confirm the scanner still passes: `node tools/scan-secrets.mjs`.
3. Confirm the app boots and a login works on the deployed environment before considering the rotation done.

## Why the values were on disk at all

The project's `.gitignore` covers `.env*` (lines 15–27), so the tree never carried them into git. They were created locally during development and left in place. `.env.example` now exists exactly so the next developer copies placeholders instead of accumulating real values in one file.
