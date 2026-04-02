# Future evolution

Likely directions for schema and workflows—**not committed work**. When implemented, update migrations and the relevant Foundry docs.

## Possible `people` table

Normalize **`entity_owners`** (and eventually company-affiliated people) into a shared **`people`** graph with join tables, reducing duplicate strings for the same human across entities.

## Better typed review tasks

Replace polymorphic `entity_type` / `entity_id` with:

- Separate nullable FK columns, or
- Typed task tables per workflow,

to regain database-enforced referential integrity.

## State-specific connector abstraction

Model each secretary-of-state (or vendor) API behind a **`registry_connectors`** config: rate limits, auth, lookup key shapes—without hardcoding per state in application code only.

## Raw record immutability rules

Optionally forbid `UPDATE` on `source_business_records` except correction workflows, or append-only “correction” rows—stronger audit for legal/compliance use cases.

## Additional enrichment layers

Credit, litigation, sanctions, or web presence layers as **separate tables** referencing `companies` or `state_entities`, similar to registry snapshots (evidence + parsed summary).

## Multi-source dedupe / clustering improvements

Stronger **`normalized_key`** strategies, blocking keys, or graph clustering to merge companies across many listings before reconciliation.

## Related

- [../schema/tables/owners.md](../schema/tables/owners.md) — current owner limitations
- [../product/problem-and-goals.md](../product/problem-and-goals.md)
