# Documentation

This directory contains architecture, implementation, and decision documentation for the FurnaceBuild project.

## Foundry (registry / company intel)

Foundry is the internal subsystem for ingesting messy business listings, building **canonical companies**, pulling **state registry** evidence, reconciling the two, and queuing human review. Conceptual and schema documentation lives under **[foundry/](./foundry/)**, starting with **[foundry/overview.md](./foundry/overview.md)**.

## 📚 Structure

### [architecture/](./architecture/)
High-level explanations of system concepts and how components work together.

- **[ARCHITECTURE_OVERVIEW.md](./architecture/ARCHITECTURE_OVERVIEW.md)** - Core concepts: Enrollments vs Message Jobs vs Lead States
- **[QUEUE_SCHEDULER_OVERVIEW.md](./architecture/QUEUE_SCHEDULER_OVERVIEW.md)** - Queue and scheduler system explained

### [implementation/](./implementation/)
Step-by-step implementation plans and guides, organized by domain (scheduler, inbox-checker, aws, flow, send-worker, inbox-ui, testing, status). See **[implementation/README.md](./implementation/README.md)** for the full index.

- **[IMPLEMENTATION_PLAN.md](./implementation/status/IMPLEMENTATION_PLAN.md)** - Master plan: scalable email infrastructure (AWS + Supabase + SMTP)
- **[COMPLETION_PLAN.md](./implementation/status/COMPLETION_PLAN.md)** - Current completion and production-readiness status

### [decisions/](./decisions/)
Decision records documenting architectural choices and rationale.

- **[QUEUE_DECISION_ANALYSIS.md](./decisions/QUEUE_DECISION_ANALYSIS.md)** - Why we chose to use only `send_queue` (and skip `event_queue` and `inbox_queue`)

## 📖 Other Documentation

- **[../SUPABASE_SETUP.md](../SUPABASE_SETUP.md)** - Supabase setup and configuration (located at project root)

### Engineering standards

- **[engineering/bulk-operations-standards.md](./engineering/bulk-operations-standards.md)** - Bulk/async jobs, RPC conventions, webhooks, and testing checklist
- **[engineering/test-convention.md](./engineering/test-convention.md)** - Domain-first outcome testing
- **[infrastructure/CLIENT_API_WEBHOOKS.md](./infrastructure/CLIENT_API_WEBHOOKS.md)** - Client API atomic vs batch webhook reference
