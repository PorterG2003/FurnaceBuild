# Implementation Documentation

Step-by-step implementation plans and guides, organized by domain.

---

## Status & overview

| Doc | Description |
|-----|-------------|
| [status/IMPLEMENTATION_PLAN.md](./status/IMPLEMENTATION_PLAN.md) | Master plan: scalable email infrastructure (AWS + Supabase + SMTP) |
| [status/IMPLEMENTATION_STATUS_REVIEW.md](./status/IMPLEMENTATION_STATUS_REVIEW.md) | Status review (see status/COMPLETION_PLAN.md for current) |
| [status/COMPLETION_PLAN.md](./status/COMPLETION_PLAN.md) | Completion plan and current production-readiness status |

---

## Scheduler (intervals, jobs, race conditions)

| Doc | Description |
|-----|-------------|
| [scheduler/CAMPAIGN_INTERVALS_IMPLEMENTATION_PLAN.md](./scheduler/CAMPAIGN_INTERVALS_IMPLEMENTATION_PLAN.md) | Campaign intervals implementation |
| [scheduler/ENROLLMENT_QUEUE_PUSH_STRATEGY.md](./scheduler/ENROLLMENT_QUEUE_PUSH_STRATEGY.md) | Enrollment queue push strategy |
| [scheduler/SENDING_INTERVAL_AND_MAILBOX_CONSISTENCY_PLAN.md](./scheduler/SENDING_INTERVAL_AND_MAILBOX_CONSISTENCY_PLAN.md) | Sending interval and mailbox consistency |
| [scheduler/SCHEDULER_RACE_CONDITION_FIX.md](./scheduler/SCHEDULER_RACE_CONDITION_FIX.md) | Scheduler race condition fix |
| [scheduler/SCHEDULER_RACE_CONDITION_FIX_SQS.md](./scheduler/SCHEDULER_RACE_CONDITION_FIX_SQS.md) | Scheduler race condition fix (SQS) |
| [scheduler/RACE_CONDITION_TESTING.md](./scheduler/RACE_CONDITION_TESTING.md) | Race condition testing |
| [scheduler/BULLETPROOF_LOCKING_ANALYSIS.md](./scheduler/BULLETPROOF_LOCKING_ANALYSIS.md) | Locking analysis for scheduler |
| [scheduler/ENROLLMENT_PAUSE_RESUME_SEMANTICS.md](./scheduler/ENROLLMENT_PAUSE_RESUME_SEMANTICS.md) | Manual enrollment pause/resume semantics and webhooks |
| [../engineering/bulk-operations-standards.md](../engineering/bulk-operations-standards.md) | Leads workbench bulk/async standards |

---

## Inbox checker (IMAP worker, ECS)

| Doc | Description |
|-----|-------------|
| [inbox-checker/IMAP_INBOX_CHECKER_ECS_PLAN.md](./inbox-checker/IMAP_INBOX_CHECKER_ECS_PLAN.md) | IMAP inbox checker ECS plan |
| [inbox-checker/IMAP_UID_VS_SEQUENCE_AND_FETCH_FIX.md](./inbox-checker/IMAP_UID_VS_SEQUENCE_AND_FETCH_FIX.md) | IMAP UID vs sequence and fetch fix |
| [inbox-checker/INBOX_CHECKER_VERIFICATION.md](./inbox-checker/INBOX_CHECKER_VERIFICATION.md) | Inbox checker verification |
| [inbox-checker/INBOX_CHECKER_TESTING.md](./inbox-checker/INBOX_CHECKER_TESTING.md) | Inbox checker testing |
| [inbox-checker/MIGRATION_LAMBDA_TO_ECS_SCHEDULER.md](./inbox-checker/MIGRATION_LAMBDA_TO_ECS_SCHEDULER.md) | Migration from Lambda to ECS scheduler |

---

## AWS infrastructure (Phase 2)

| Doc | Description |
|-----|-------------|
| [aws/PHASE2_AWS_INFRASTRUCTURE.md](./aws/PHASE2_AWS_INFRASTRUCTURE.md) | Phase 2 AWS infrastructure overview |
| [aws/PHASE2.1_SQS_SETUP.md](./aws/PHASE2.1_SQS_SETUP.md) | SQS setup |
| [aws/PHASE2.2_SETUP_IAM_AND_CLOUDWATCH.md](./aws/PHASE2.2_SETUP_IAM_AND_CLOUDWATCH.md) | IAM and CloudWatch setup |
| [aws/PHASE2.3_ECS_SETUP.md](./aws/PHASE2.3_ECS_SETUP.md) | ECS setup |
| [aws/PHASE2.6_DOCKER_IMAGES_ECR.md](./aws/PHASE2.6_DOCKER_IMAGES_ECR.md) | Docker images and ECR |

---

## Flow engine

| Doc | Description |
|-----|-------------|
| [flow/PHASE3.1_FLOW_EVALUATION_ENGINE.md](./flow/PHASE3.1_FLOW_EVALUATION_ENGINE.md) | Flow evaluation engine |

---

## Send worker (SMTP)

| Doc | Description |
|-----|-------------|
| [send-worker/CONNECTION_POOLING_EXPLAINED.md](./send-worker/CONNECTION_POOLING_EXPLAINED.md) | SMTP connection pooling |

---

## Campaign stats

| Doc | Description |
|-----|-------------|
| [campaign-stats/CAMPAIGN_STATS_CALCULATIONS.md](./campaign-stats/CAMPAIGN_STATS_CALCULATIONS.md) | Stat definitions, who updates them, and how totals vs per-day charts are read |

---

## Inbox UI

| Doc | Description |
|-----|-------------|
| [inbox-ui/MASTER_INBOX_UI_PLAN.md](./inbox-ui/MASTER_INBOX_UI_PLAN.md) | Master inbox UI implementation plan |

---

## Testing

| Doc | Description |
|-----|-------------|
| [testing/TEST_SYSTEM_FIXES.md](./testing/TEST_SYSTEM_FIXES.md) | Test system fixes |
| [testing/TEST_VS_PRODUCTION_LOGIC.md](./testing/TEST_VS_PRODUCTION_LOGIC.md) | Test vs production logic |
