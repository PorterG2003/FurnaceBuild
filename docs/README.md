# Documentation

This directory contains architecture, implementation, and decision documentation for the FurnaceBuild project.

## 📚 Structure

### [architecture/](./architecture/)
High-level explanations of system concepts and how components work together.

- **[ARCHITECTURE_OVERVIEW.md](./architecture/ARCHITECTURE_OVERVIEW.md)** - Core concepts: Enrollments vs Message Jobs vs Lead States
- **[QUEUE_SCHEDULER_OVERVIEW.md](./architecture/QUEUE_SCHEDULER_OVERVIEW.md)** - Queue and scheduler system explained

### [implementation/](./implementation/)
Step-by-step implementation plans and guides.

- **[IMPLEMENTATION_PLAN.md](./implementation/IMPLEMENTATION_PLAN.md)** - Complete implementation plan for scalable email infrastructure (AWS + Supabase + SMTP)

### [decisions/](./decisions/)
Decision records documenting architectural choices and rationale.

- **[QUEUE_DECISION_ANALYSIS.md](./decisions/QUEUE_DECISION_ANALYSIS.md)** - Why we chose to use only `send_queue` (and skip `event_queue` and `inbox_queue`)

## 📖 Other Documentation

- **[../SUPABASE_SETUP.md](../SUPABASE_SETUP.md)** - Supabase setup and configuration (located at project root)
