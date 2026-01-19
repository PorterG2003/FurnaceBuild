# Dev/Prod Infrastructure Plan

## Overview

Cost-optimized infrastructure plan that prioritizes cost savings over production safety and convenience.

**Key Principles:**
- Supabase branches (dev + prod branches in single project)
- Minimal dev environment (cost-focused)
- Minimal prod environment (functional but not over-engineered)
- Separate ECS worker infrastructure from Amplify (to avoid deployment issues)

---

## Architecture Decisions

### 1. **Database: Supabase Branches** ✅
- **Single Supabase project** with separate branches for dev and prod
- **Dev branch:** Separate database schema for development
- **Prod branch:** Separate database schema for production
- True data isolation (no shared tables, no filtering needed)
- **Cost:** ~$25-50/month (Supabase Pro tier - branching included)
- **Benefits:** Cleaner than environment filtering, easier to manage, true isolation

### 2. **ECS Workers: Separate Dev and Prod** ✅
- **Separate dev workers** - process dev data only
- **Separate prod workers** - process prod data only
- Remove ECS workers from `amplify/backend.ts`
- Create separate `infra/workers/` CDK project
- Deploy workers independently per environment
- **Why:** Full isolation between dev and prod
- **Why separate CDK:** Avoid Amplify deployment timeouts and conflicts

### 3. **Environments: Dev + Prod (No Staging)**
- **Dev:** Separate workers, dev frontend (Amplify sandbox)
- **Prod:** Separate workers, prod frontend (Amplify production)
- **Database:** Shared with strong isolation
- **Cost:** ~$60-110/month for workers (separate dev/prod sets)

---

## Dev Environment

### Resources

**Frontend/API (Amplify):**
- Amplify sandbox deployment (free tier)
- Lambda functions: minimal
- **Cost:** $0 (free tier)

**ECS Workers (CDK Stack):**
- **Send Worker:** 1 task (0.5 vCPU, 1 GB)
- **Scheduler Worker:** 1 task (0.5 vCPU, 1 GB)
- **ECR Repositories:** 2 repos (free - only pay for storage)
- **ECS Cluster:** 1 cluster (free - only pay for tasks)
- **VPC:** Minimal (public subnets only, no NAT Gateway)
- **CloudWatch Logs:** 1 week retention
- **Cost:** ~$15-30/month (2 Fargate tasks)

**Database:**
- Supabase dev branch (separate database schema)
- Connection via Supabase branch URL

**Total Dev Cost:** ~$15-30/month

### Deployment Strategy

**Initial Setup:**
- Manual CDK deployment for workers (`cdk deploy WorkerStack-Dev`)
- Manual Docker image pushes (when needed)
- Workers configured to process dev data only (environment filtering)

**Daily Workflow:**
- Frontend changes → Auto-deploy via Amplify
- Worker code changes → Manual deploy when needed (dev only)
- Database → Supabase dev branch (separate schema)

### Trade-offs (Accepted)

- ✅ Workers may be down occasionally (manual deploys OK)
- ✅ No auto-scaling (fixed 1 task each)
- ✅ Separate dev workers (full isolation)
- ✅ Supabase dev branch (true data isolation)
- ✅ Manual image builds/pushes

---

## Prod Environment

### Resources

**Frontend/API (Amplify):**
- Amplify production deployment
- Lambda functions: minimal
- **Cost:** ~$15-25/month (Amplify hosting)

**ECS Workers (CDK Stack):**
- **Send Worker:** 1-2 tasks (0.5 vCPU, 1 GB) - scale to 2 if needed
- **Scheduler Worker:** 1-2 tasks (0.5 vCPU, 1 GB) - scale to 2 if needed
- **ECR Repositories:** 2 repos (free - only pay for storage)
- **ECS Cluster:** 1 cluster (free - only pay for tasks)
- **VPC:** Minimal (public subnets only, no NAT Gateway)
- **CloudWatch Logs:** 1 week retention
- **Cost:** ~$30-60/month (2-4 Fargate tasks)

**Database:**
- Supabase prod branch (separate database schema)
- Connection via Supabase branch URL

**Total Prod Cost:** ~$45-85/month

### Deployment Strategy

**Initial Setup:**
- Manual CDK deployment for workers (`cdk deploy WorkerStack-Prod`)
- Manual Docker image pushes (via GitHub Actions or manual)
- Use git tags/versions for image tags
- Workers configured to process prod data only (environment filtering)

**Daily Workflow:**
- Frontend changes → Auto-deploy via Amplify
- Worker code changes → Manual deploy (prod only, test in dev first)
- Database → Supabase prod branch (separate schema)

### Trade-offs (Accepted)

- ✅ Workers may be down occasionally (manual deploys OK)
- ✅ No auto-scaling initially (fixed 1-2 tasks each)
- ✅ Separate prod workers (full isolation)
- ✅ Supabase prod branch (true data isolation)
- ✅ Manual image builds/pushes
- ⚠️ No staging environment (test in dev, deploy to prod)

---

## Frontend Environments

### Dev (Amplify Sandbox)
- Amplify sandbox deployment (free tier)
- Lambda functions: minimal
- **Cost:** $0 (free tier)

### Prod (Amplify Production)
- Amplify production deployment
- Lambda functions: minimal
- **Cost:** ~$15-25/month (Amplify hosting)

**Total Frontend Cost:** ~$15-25/month

### Trade-offs (Accepted for Cost)

- ⚠️ **No staging environment** (test in dev, deploy to prod)
- ⚠️ **Manual worker deployments** (accept downtime for updates)
- ⚠️ **No auto-scaling** (manual scale-up if needed)
- ⚠️ **No blue/green deployments** (rolling updates only)
- ⚠️ **Limited monitoring** (CloudWatch logs only, no advanced alerts)

---

## Infrastructure Structure

```
FurnaceBuild/
├── amplify/                    # Frontend + Lambda functions
│   ├── backend.ts             # Remove ECS workers from here
│   └── ...
│
├── infra/                      # NEW: Separate CDK project
│   └── workers/
│       ├── package.json
│       ├── tsconfig.json
│       ├── cdk.json
│       ├── bin/
│       │   └── workers.ts     # Dev + Prod stacks
│       └── lib/
│           └── worker-stack.ts
│
└── workers/                    # Worker code (unchanged)
    ├── send-worker/
    └── scheduler-worker/
```

---

## Cost Breakdown (Monthly)

| Resource | Dev | Prod | Total |
|----------|-----|------|-------|
| **Database (Supabase Branches)** | - | - | $25-50 |
| **Frontend/API (Amplify)** | $0 (free) | $15-25 | $15-25 |
| **ECS Workers** | $15-30 | $30-60 | $45-90 |
| **ECR Repositories** | $0 (free) | $0 (free) | $0 |
| **CloudWatch Logs** | ~$2-5 | ~$5-10 | $7-15 |
| **VPC/Networking** | $0 | $0 | $0 |
| **Total** | **$17-35** | **$50-95** | **~$92-180/month** |

**Target:** < $200/month for dev + prod

**Note:** Could save $25-50/month by sharing workers, but isolation is prioritized.

---

## Migration Plan

### Phase 1: Remove Workers from Amplify (Week 1)

1. ✅ Remove ECS infrastructure from `amplify/backend.ts`
2. ✅ Keep only: Frontend, Lambdas, API, Auth
3. ✅ Test Amplify deployment (should be fast now)

### Phase 2: Create Separate CDK Stack (Week 1-2)

1. Create `infra/workers/` CDK project
2. Extract ECS infrastructure from `amplify/backend.ts`
3. Set up dev + prod stacks (separate environments)
4. Deploy dev stack with `desiredCount: 0` initially

### Phase 3: Deploy Dev Workers (Week 2)

1. Build Docker images for dev
2. Push to ECR (dev repos)
3. Deploy dev CDK stack
4. Scale up to 1 task each
5. Verify workers run and process dev data only

### Phase 4: Deploy Prod Workers (Week 2-3)

1. Build Docker images for prod
2. Push to ECR (prod repos)
3. Deploy prod CDK stack
4. Scale up to 1-2 tasks each
5. Verify workers run and process prod data only

### Phase 5: Database Branching Setup (Week 3)

1. Create Supabase dev branch
2. Create Supabase prod branch (or use main)
3. Configure workers to use appropriate branch URL
4. Configure frontend/API to use appropriate branch URL
5. Test data isolation between branches

---

## Scaling Strategy (Future)

### When to Add Staging

- Monthly revenue > $5,000
- Or production incidents > 1/month
- Or team size > 3 engineers

### When to Add Auto-Scaling

- Worker utilization > 80% consistently
- Or queue depth > 1000 messages regularly
- Cost of manual scaling > cost of auto-scaling overhead

### When to Use Separate Supabase Projects (instead of branches)

- Monthly revenue > $10,000
- Or need separate billing/quotas
- Or need different Supabase plans for dev vs prod
- **Note:** Branches are usually sufficient for dev/prod isolation

---

## Risk Mitigation

### Database Branching Considerations

**Benefits:**
- ✅ True data isolation (separate schemas)
- ✅ No filtering logic needed in application code
- ✅ Cleaner queries (no environment checks)
- ✅ Standard database branching workflow

**Considerations:**
- ⚠️ Migrations apply to branches (need to apply to both)
- ⚠️ Need to manage branch connection URLs
- ⚠️ Branch-specific data requires separate seeding
- ✅ Supabase handles backups per branch
- ✅ Can merge branches if needed

**Best Practices:**
- Keep migrations in sync between branches (apply to both)
- Use branch-specific connection URLs in environment variables
- Test migrations on dev branch before prod
- Regular backups (Supabase handles per branch)

### Manual Deployments

**Risk:** Worker downtime during deployments

**Mitigation:**
- Deploy during low-traffic hours
- Keep old tasks running until new ones are healthy
- Accept brief downtime (acceptable for cost savings)

### No Staging

**Risk:** Bugs in prod

**Mitigation:**
- Thorough testing in dev
- Manual smoke tests before prod deploy
- Feature flags for risky changes
- Rollback plan (CDK makes this easy)

---

## Next Steps

1. **Review this plan** - Does this meet your cost/risk tolerance?
2. **Decide on data isolation** - Environment column vs schema prefixes?
3. **Start Phase 1** - Remove workers from Amplify
4. **Create CDK project** - Set up `infra/workers/`
5. **Deploy dev** - Get dev working first
6. **Deploy prod** - Once dev is stable

---

## Questions to Consider

1. **Database isolation:** Environment column or separate schemas?
2. **Worker scaling:** Start with 1 task each, or 2 for prod?
3. **Deployment frequency:** How often will you deploy workers? (affects manual deploy cost/risk)
4. **Monitoring:** CloudWatch logs only, or add basic alerts?
5. **Backup strategy:** Rely on Supabase backups, or add custom backups?

