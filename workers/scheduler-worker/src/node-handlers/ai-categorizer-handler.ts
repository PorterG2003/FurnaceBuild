import { SupabaseClient } from '@supabase/supabase-js';
import { reportErrorToSlack } from '@furnace/slack-lib';
import type { Enrollment } from '../types.js';

/**
 * Handle AICategorizer node: branching logic based on AI categorization
 * 
 * PLACEHOLDER IMPLEMENTATION:
 * - For now, selects the first/default category path
 * - Phase 3.4+: Will implement AI evaluation to select specific category
 * 
 * @param enrollment - The enrollment being processed
 * @param node - The AICategorizer node from the flow
 * @param flowData - Campaign flow_data (for finding edges)
 * @param supabase - Supabase client
 * @returns The selected next node's flow_node_id (or null if no match)
 */
export async function handleAICategorizerNode(
  enrollment: Enrollment,
  node: any,
  flowData: any,
  supabase: SupabaseClient
): Promise<string | null> {
  // 1. Load AICategorizer node data
  const categories = node.node_data?.categories || [];
  const prompt = node.node_data?.prompt || '';

  if (categories.length === 0) {
    const warning = `AICategorizer node ${node.id} (enrollment ${enrollment.id}) has no categories defined`;
    console.warn(warning);
    reportErrorToSlack('AICategorizer node has no categories defined', {
      severity: 'warning',
      enrollment_id: enrollment.id,
      node_id: node.id,
    });
    return null;
  }

  // 2. PLACEHOLDER: Select first/default category path
  // Phase 3.4+: Will call AI service to categorize lead and select matching category
  const selectedCategory = categories[0];

  // 3. Find edge matching selected category
  const edges = flowData?.edges || [];
  const matchingEdge = edges.find((edge: any) => {
    // Edge label should match the selected category
    return edge.source === node.flow_node_id && 
           (edge.label === selectedCategory || edge.data?.category === selectedCategory);
  });

  if (!matchingEdge) {
    const warning = `No edge found for category "${selectedCategory}" from AICategorizer node ${node.id} (enrollment ${enrollment.id})`;
    console.warn(warning);
    reportErrorToSlack('AICategorizer edge mismatch (no edge for selected category)', {
      severity: 'warning',
      enrollment_id: enrollment.id,
      node_id: node.id,
      category: selectedCategory,
    });
    // Fallback: Use first edge from this node
    const firstEdge = edges.find((edge: any) => edge.source === node.flow_node_id);
    if (firstEdge) {
      return firstEdge.target;
    }
    return null;
  }

  // 4. Return target node's flow_node_id
  // Note: The flow evaluation will load the actual database node using this flow_node_id
  return matchingEdge.target;
}

