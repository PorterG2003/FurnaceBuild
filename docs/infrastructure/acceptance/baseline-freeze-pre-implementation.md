# Acceptance artifact — baseline freeze (pre-change)

- Wave name: `baseline-freeze-pre-implementation`
- Environment: account-wide read-only
- Captured at (UTC): 2026-08-05 (session date 2026-08-04 local)
- Prior task definition revisions: n/a (no deploy in this artifact)
- Exact rollback command: n/a

## Baseline window

- Start / end (UTC): 2026-07-29 → 2026-08-05 (Cost Explorer)
- Workload count: not frozen in this artifact (capture fixture line/byte counts before logging canary)
- Cost Explorer UnblendedCost by service (7-day partial month slice, USD):

| Service | Cost |
| --- | ---: |
| AmazonCloudWatch | 66.27 |
| Amazon Elastic Container Service | 22.28 |
| Amazon Virtual Private Cloud | 5.57 |
| AWS Amplify | 3.39 |
| Amazon Elastic Load Balancing | 3.33 |
| Tax | 2.93 |
| AWS Secrets Manager | 1.59 |
| AWS Key Management Service | 1.36 |
| Amazon Route 53 | 1.00 |
| ECR | 0.42 |
| Other | <0.50 each |
| **TOTAL** | **109.10** |

Note: this is a short mid-period slice, not a full July-like month. July baseline for success metrics remains the earlier ~$573 analysis.

## Decision

- [x] Pass — baseline captured; proceed with code implementation and **dev** deploy
- [ ] Prod worker deploy — **blocked** until explicit prod OK

## Notes

- IaC desired counts corrected to dev `0/0/0`, prod `1/1/1` before any worker-stack prod deploy.
- Production deployment, image build/restart, ALB/secret deletion remain gated.
- Use `docs/infrastructure/aws-cost-acceptance-artifact-template.md` for post-deploy waves.
