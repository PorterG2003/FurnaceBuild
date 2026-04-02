# Problem and goals

## Problem statement

Go-to-market and research workflows need a **canonical view of companies** (who they are, where they operate) that is **grounded in evidence**—especially **state business registry** data—while still accepting **noisy inputs** (scrapes, listings, third-party feeds). Without clear separation between “what a source said,” “what we believe internally,” and “what the registry returned,” teams lose auditability and automate the wrong invariants.

## Inputs

- **Batch or streaming business records** from one or more sources (names, addresses, URLs, raw JSON).
- **Registry API or scrape responses** keyed by lookup parameters (state, entity id, name search, etc.).
- **Human judgment** where automation cannot safely decide (duplicate companies, ambiguous matches, bad parses).

## Outputs

- **Canonical companies** (`companies`, `company_locations`) suitable for product and operations.
- **Provenance:** which raw rows linked to which company; which registry snapshot produced which `state_entities`.
- **Match decisions:** candidates, promoted registry links, rejections—with versioned matcher/scoring metadata.
- **Owner rows** (`entity_owners`) extracted from registry parses, with hooks for future identity resolution.
- **Audit trail:** `*_history`, immutable `registry_source_snapshots`, `reconciliation_results`.

## Primary user jobs

- **Import data** without corrupting canonical truth (runs, stats, failure visibility).
- **Resolve** a raw row to the right company—or create one—without breaking “at most one linked” rules.
- **Prove** registry-backed facts: store raw responses, parse entities, reconcile to canonical companies.
- **Review** edge cases in a single queue (`review_tasks`).
- **Inspect history** when something changed or a constraint failed.

## Non-goals (v1)

- Replacing the main Furnace **campaign** `leads` table or sending infrastructure (separate database and product surface).
- A full **people graph** or global officer deduplication (owner normalization fields are preparatory).
- Client-side direct SQL/PostgREST access to registry tables from the mobile app.

## Success criteria

- Operators can trace **from raw source row → company → registry entity → owners** with stored evidence and versions.
- The database **rejects** invalid workflow states (e.g. two current `linked` companies for one source row; two current `promoted` matches for the same company and state).
- New engineers and contractors can onboard using [../overview.md](../overview.md), [core-concepts.md](core-concepts.md), and [../schema/schema-overview.md](../schema/schema-overview.md) without reading every migration.
