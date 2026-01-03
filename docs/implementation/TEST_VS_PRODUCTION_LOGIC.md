# Test vs Production Logic Analysis

## Overview
This document identifies duplicate logic between the scheduler test page and production code, and highlights potential divergence risks.

## Duplicate Logic Areas

### 1. Flow Template Structure ⚠️ **HIGH RISK**

**Test Code:**
- `app/(main)/test/scheduler.tsx` - `createFlowTemplate()` function (lines 25-161)
- Creates hardcoded flow structures for test templates
- Defines node types, positions, edges manually

**Production Code:**
- `app/(main)/builder/index.tsx` - Flow builder UI creates flows
- Flows saved to `campaigns.flow_data` JSONB column
- Database trigger auto-syncs to `nodes` table

**Risk:**
- Test templates may not match production flow structure
- If production flow format changes, tests won't catch it
- Test validation logic counts email nodes from template, but production doesn't validate this

**Recommendation:**
- Extract flow template creation to shared utility
- Or: Test should use actual flow builder to create flows (more realistic)
- Or: Document that test templates are simplified versions for testing only

---

### 2. Node Creation Logic ⚠️ **MEDIUM RISK**

**Test Code:**
```typescript
// app/(main)/test/scheduler.tsx lines 652-673
const nodeInserts = flowData.nodes
  .filter(node => node.type !== 'leadSource') // Skip leadSource nodes
  .map((node, index) => ({
    campaign_id: campaign.id,
    flow_node_id: node.id,
    node_type: node.type,
    node_data: node.data || {},
    position_x: node.position.x,
    position_y: node.position.y,
  }));
await supabase.from('nodes').insert(nodeInserts);
```

**Production Code:**
- Database trigger `sync_campaign_nodes()` (migration 20251121120000)
- Auto-syncs when `campaigns.flow_data` changes
- Same logic: extracts nodes from `flow_data.nodes`, filters, inserts

**Risk:**
- Test manually creates nodes, production uses trigger
- If trigger logic changes, test won't reflect it
- Test filters `leadSource` nodes - trigger does too, but logic could diverge

**Recommendation:**
- Test should rely on trigger (create campaign with flow_data, let trigger handle nodes)
- Or: Extract node creation logic to shared function

---

### 3. Flow Evaluation Logic ✅ **LOW RISK** (Actually Shared)

**Test Code:**
- Uses `createFlowTemplate()` to analyze flow structure for validation
- Counts email nodes to determine expected message jobs

**Production Code:**
- `workers/scheduler-worker/src/flow-evaluation.ts` - `evaluateFlow()` function
- Reads from database `nodes` table
- Uses `campaigns.flow_data.edges` for traversal

**Risk:**
- Test validation logic is separate from production evaluation
- Test counts nodes from template, production reads from database
- Could diverge if node structure changes

**Recommendation:**
- Test validation should query database nodes (like production does)
- Or: Share flow analysis logic between test and production

---

### 4. Schedule Configuration ✅ **LOW RISK**

**Test Code:**
- UI for schedule configuration (timezone, hours, days)
- Builds schedule object, validates it
- Passes to `createCampaign()`

**Production Code:**
- Reads schedule from `campaigns.schedule` JSONB column
- Uses `workers/scheduler-worker/src/scheduling.ts` functions

**Risk:**
- Test builds schedule object, production reads it
- Format should match, but no validation

**Recommendation:**
- Use shared TypeScript type for schedule structure
- Validate schedule format matches between test and production

---

### 5. Jitter Configuration ✅ **LOW RISK**

**Test Code:**
- UI for jitter percentage
- Validates 0-100 range
- Passes to campaign creation

**Production Code:**
- Reads from `campaigns.jitter_percentage` or `accounts.jitter_percentage`
- Uses in `calculateScheduledAt()` function

**Risk:**
- Test validates jitter, production just reads it
- Should be fine, but no shared validation

**Recommendation:**
- Extract jitter validation to shared utility
- Use same validation in production campaign creation

---

### 6. Expected Message Job Count Calculation ⚠️ **MEDIUM RISK**

**Test Code:**
```typescript
// app/(main)/test/scheduler.tsx lines 1319-1320
const flowNodeTypes = flowTemplate.nodes.map((n: any) => n.type).filter(Boolean);
const emailNodeCount = flowNodeTypes.filter((t: string) => t === 'email').length;
const expectedMessageJobCount = emailNodeCount;
```

**Production Code:**
- No equivalent logic - scheduler just processes whatever nodes exist
- Doesn't validate expected vs actual job count

**Risk:**
- Test assumes 1 email node = 1 message job
- This is correct, but if logic changes (e.g., conditional emails), test won't catch it
- Test validation could give false positives/negatives

**Recommendation:**
- This validation is test-only (which is fine)
- Document the assumption: "Each email node creates exactly one message job"
- Consider querying actual database nodes instead of template

---

## Summary of Risks

### High Risk (Could Cause Test/Production Divergence):
1. **Flow Template Structure** - Test templates may not match production flows ✅ **MITIGATED** - Documented as simplified test templates

### Medium Risk (Logic Duplication):
2. **Node Creation** - Test manually creates, production uses trigger ✅ **FIXED** - Test now uses database trigger
3. **Expected Job Count** - Test calculates from template, production doesn't validate ✅ **FIXED** - Test now queries database nodes

### Low Risk (Format/Structure):
4. **Schedule Configuration** - Should match, but no validation (acceptable)
5. **Jitter Configuration** - Should match, but no validation (acceptable)
6. **Flow Evaluation** - Uses database nodes for validation (matches production approach) ✅ **FIXED**

---

## Implementation Status

### ✅ Completed:
1. **Trigger-Based Node Creation**: Test now relies on database trigger `sync_campaign_nodes()` instead of manual insertion
2. **Database-Based Validation**: Test validation queries `nodes` table (like production) instead of analyzing template
3. **Documentation**: Added comments explaining test templates are simplified versions and trigger-based approach

### Future Improvements (Optional):
1. **Extract Shared Types**: Create shared TypeScript types for schedule, jitter, flow structure
2. **Shared Flow Utilities**: Extract flow analysis logic to shared package
3. **Integration Tests**: Add tests that use actual flow builder output instead of hardcoded templates

---

## Current State: Improved ✅

The test now:
- ✅ Uses database trigger for node creation (matches production)
- ✅ Queries database nodes for validation (matches production approach)
- ✅ Has clear documentation about test templates being simplified versions
- ✅ Minimal duplication with production logic

**Remaining Minor Risks**:
- Test templates are still hardcoded (acceptable - they're simplified test cases)
- Schedule/jitter validation could use shared types (low priority)

