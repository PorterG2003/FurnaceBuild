# Conditional AWS cleanup opportunities (verification only)

**Status:** evidence gathering — **no deletions performed**. Each item needs explicit production approval immediately before any delete.

Date: 2026-08-04  
Account: `686255981838`

## 1. Orphan-looking ALB + EIP (~$20.50/month)

Suspected idle API-doc-scraper ALB from earlier cost analysis (July `RequestCount = 0`).

Before requesting deletion approval, verify all of:

- [ ] Listeners and target groups (healthy/unhealthy counts)
- [ ] Tags / naming / CloudFormation stack ownership
- [ ] Route 53 and external DNS references
- [ ] Access logs (if enabled) for 30/90 days
- [ ] 30/90-day `RequestCount`, `ProcessedBytes`, `NewConnectionCount`
- [ ] Export full ALB + listener + TG + EIP configuration for recreation
- [ ] Confirm EIP is attached to this ALB only — never delete EIP independently

Rollback requirement: recreation runbook with exported config ready before approval ask.

## 2. Secrets Manager candidates ($3–7/month)

`LastAccessedDate` is a lead only, not proof of disuse.

Before each deletion:

- [ ] Cross-check secret name against app code, Amplify secrets, SSM, and integration rows
- [ ] Confirm owning account / environment
- [ ] Check recent CloudTrail `GetSecretValue` if available
- [ ] Use Secrets Manager recovery window (do not force-delete)

## 3. ECR lifecycle tightening ($1.5–2.3/month)

Current worker repos keep last 10 images.

Safe tightening plan:

- [ ] Collect every image digest referenced by **active** ECS task definitions (dev + prod)
- [ ] Keep **≥5** production rollback images
- [ ] Use 3–5 for dev
- [ ] Add untagged-image expiry only after tagged rollback set is protected
- [ ] Never allow lifecycle to remove the only known-good rollback image

## 4. Amplify build batching ($5–9/month)

Operational only:

- Batch merges to `main` when practical
- Cancel only **queued/superseded** builds
- Never cancel an in-progress `ampx pipeline-deploy` (can desync backend/frontend)

## Approval gate reminder

None of the above is authorized by implementing the cost plan. Ask separately with surface, env (`prod`), command, and blast radius per `.cursor/rules/deploy-guardrails.mdc`.
