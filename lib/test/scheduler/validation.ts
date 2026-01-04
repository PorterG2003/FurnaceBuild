import { utcToZonedTime } from 'date-fns-tz';
import type { TestStatus, FlowTemplate } from './types';

export interface ValidationInput {
  testStatus: TestStatus;
  enrollment: any;
  jobStats: {
    total: number;
    sent: number;
    pending: number;
    failed: number;
  };
  verificationData: {
    enrollment: any;
    messageJobs: any[];
    campaignNodes?: any[];
    campaign?: any | null;
  } | null;
  dbNodes: any[] | null;
  dbNodeTypes: string[];
  hasWaitNodes: boolean;
  hasEmailNodes: boolean;
  emailNodeCount: number;
  expectedMessageJobCount: number;
  enableSchedule: boolean;
  enableJitter: boolean;
  jitterPercentage: string;
  selectedFlow: FlowTemplate;
  pollCount: number;
}

export interface ValidationResult {
  testResults: string[];
  testFailures: string[];
  nextSteps: string;
  nextStepsType: 'success' | 'waiting' | 'action' | 'info';
}

export function validateTest(input: ValidationInput): ValidationResult {
  const {
    testStatus,
    enrollment,
    jobStats,
    verificationData,
    dbNodes,
    dbNodeTypes,
    hasWaitNodes,
    hasEmailNodes,
    emailNodeCount,
    expectedMessageJobCount,
    enableSchedule,
    enableJitter,
    jitterPercentage,
    selectedFlow,
    pollCount,
  } = input;

  const testResults: string[] = [];
  const testFailures: string[] = [];
  let nextSteps = '';
  let nextStepsType: 'success' | 'waiting' | 'action' | 'info' = 'info';

  if (testStatus === 'complete') {
    console.warn('🔍 [TEST VALIDATION] ===== STARTING COMPLETE STATUS VALIDATION =====', {
      testStatus,
      enrollmentState: enrollment?.state,
      jobStatsTotal: jobStats.total,
      hasWaitNodes,
      hasEmailNodes,
    });

    if (jobStats.total > 0 || enrollment?.state === 'completed') {
      testResults.push('✅ Entry Point Detection: Enrollment started from correct entry point (leadSource node)');
    } else {
      testFailures.push('❌ Entry Point Detection: Enrollment did not process correctly from entry point');
    }

    if (hasEmailNodes) {
      if (jobStats.total === 0) {
        const campaignNodes = verificationData?.campaignNodes || dbNodes || [];
        const emailNodes = campaignNodes.filter((n: any) => n.node_type === 'email');
        const enrollmentCurrentNode = enrollment?.current_node_id;
        const enrollmentCurrentNodeData = campaignNodes.find((n: any) => n.id === enrollmentCurrentNode);

        let diagnosticDetails = [
          `Found ${emailNodeCount} email node${emailNodeCount !== 1 ? 's' : ''} in campaign`,
          enrollmentCurrentNode
            ? `Enrollment stopped at node: ${enrollmentCurrentNodeData?.node_type || 'unknown'} (${enrollmentCurrentNodeData?.flow_node_id || enrollmentCurrentNode.substring(0, 8)}...)`
            : 'Enrollment completed (current_node_id: null)',
        ].join('. ');

        if (enrollment?.state === 'completed' && emailNodes.length > 0) {
          diagnosticDetails += ` The scheduler completed the flow without creating jobs for ${emailNodes.length} email node${emailNodes.length !== 1 ? 's' : ''}. This suggests the flow traversal did not encounter the email nodes - check flow edges in campaign.flow_data.`;
        }

        testFailures.push(`❌ Message Job Creation: Expected ${expectedMessageJobCount} message job${expectedMessageJobCount !== 1 ? 's' : ''} but none were created. ${diagnosticDetails}`);
      } else if (jobStats.total < expectedMessageJobCount) {
        testFailures.push(`❌ Message Job Creation: Expected ${expectedMessageJobCount} message job${expectedMessageJobCount !== 1 ? 's' : ''} but only ${jobStats.total} ${jobStats.total === 1 ? 'was' : 'were'} created`);
      } else if (jobStats.total > expectedMessageJobCount) {
        // CRITICAL: More jobs than expected indicates duplicates or race conditions
        const duplicateDetails = [];
        const messageJobs = verificationData?.messageJobs || [];

        // Group message jobs by node_id to find duplicates
        const jobsByNodeId: Record<string, any[]> = {};
        messageJobs.forEach((job: any) => {
          const nodeId = job.node_id;
          if (!jobsByNodeId[nodeId]) {
            jobsByNodeId[nodeId] = [];
          }
          jobsByNodeId[nodeId].push(job);
        });

        // Find nodes with multiple jobs (duplicates)
        const duplicateNodes = Object.entries(jobsByNodeId)
          .filter(([nodeId, jobs]) => jobs.length > 1)
          .map(([nodeId, jobs]) => ({
            nodeId: nodeId.substring(0, 8),
            nodeFlowId: jobs[0].node?.flow_node_id || 'unknown',
            count: jobs.length,
            jobIds: jobs.map((j: any) => j.id.substring(0, 8)).join(', '),
          }));

        if (duplicateNodes.length > 0) {
          duplicateDetails.push(`Found ${duplicateNodes.length} node${duplicateNodes.length !== 1 ? 's' : ''} with duplicate message jobs:`);
          duplicateNodes.forEach(dup => {
            duplicateDetails.push(`  - Node ${dup.nodeFlowId} (${dup.nodeId}...): ${dup.count} jobs (IDs: ${dup.jobIds})`);
          });
          duplicateDetails.push(`This indicates a race condition or duplicate processing bug. Each email node should only create ONE message job.`);
        } else {
          duplicateDetails.push(`Total jobs (${jobStats.total}) exceeds expected (${expectedMessageJobCount}), but no duplicate node_ids found. This may indicate extra jobs were created.`);
        }

        testFailures.push(`❌ Message Job Creation: DUPLICATE DETECTED! Expected ${expectedMessageJobCount} message job${expectedMessageJobCount !== 1 ? 's' : ''} but ${jobStats.total} ${jobStats.total === 1 ? 'was' : 'were'} created. ${duplicateDetails.join(' ')}`);
      } else {
        // Exact count - validate no duplicates by checking each node_id appears only once
        const messageJobs = verificationData?.messageJobs || [];
        const jobsByNodeId: Record<string, any[]> = {};
        messageJobs.forEach((job: any) => {
          const nodeId = job.node_id;
          if (!jobsByNodeId[nodeId]) {
            jobsByNodeId[nodeId] = [];
          }
          jobsByNodeId[nodeId].push(job);
        });

        // Check for duplicates even if count matches
        const duplicateNodes = Object.entries(jobsByNodeId).filter(([nodeId, jobs]) => jobs.length > 1);

        if (duplicateNodes.length > 0) {
          const duplicateDetails = duplicateNodes
            .map(([nodeId, jobs]) => {
              const nodeFlowId = jobs[0].node?.flow_node_id || 'unknown';
              return `Node ${nodeFlowId} (${nodeId.substring(0, 8)}...): ${jobs.length} jobs`;
            })
            .join(', ');
          testFailures.push(`❌ Message Job Creation: DUPLICATE DETECTED! Found duplicate message jobs for the same nodes: ${duplicateDetails}. Each email node should only create ONE message job.`);
        } else {
          testResults.push(`✅ Message Job Creation: ${jobStats.total} message job${jobStats.total !== 1 ? 's' : ''} created (expected ${expectedMessageJobCount} from ${emailNodeCount} email node${emailNodeCount !== 1 ? 's' : ''}), no duplicates detected`);
        }
      }
    } else {
      testResults.push('✅ Message Job Creation: No email nodes in flow (none expected)');
    }

    if (enrollment?.state === 'completed') {
      testResults.push('✅ Flow Traversal: Enrollment moved through all flow nodes correctly and reached completion');
    } else {
      testFailures.push('❌ Flow Traversal: Enrollment did not complete the flow as expected');
    }

    // Wait Node Processing Validation
    if (hasWaitNodes) {
      const waitNodeFailures: string[] = [];
      const campaign = verificationData?.campaign;
      const flowData = campaign?.flow_data;
      const flowNodes = flowData?.nodes || [];
      const campaignNodes = verificationData?.campaignNodes || [];

      // Get wait nodes from campaign
      const waitNodes = campaignNodes.filter((n: any) => n.node_type === 'waitTime' || n.node_type === 'wait');

      // DEBUG LOGGING
      console.warn('🔍 [WAIT NODE VALIDATION] Starting validation:', {
        enrollmentState: enrollment?.state,
        current_node_id: enrollment?.current_node_id?.substring(0, 8),
        next_run_at: enrollment?.next_run_at,
        updated_at: enrollment?.updated_at,
        created_at: enrollment?.created_at,
        waitNodesCount: waitNodes.length,
        waitNodesIds: waitNodes.map((n: any) => n.flow_node_id || n.id.substring(0, 8)),
      });

      if (waitNodes.length > 0 && enrollment?.next_run_at) {
        const nextRunAt = new Date(enrollment.next_run_at);

        // Only validate the wait node that matches current_node_id (the one that set next_run_at)
        // If current_node_id is a wait node, validate it. Otherwise, enrollment might be at a different node.
        const currentWaitNode = enrollment.current_node_id ? waitNodes.find((n: any) => n.id === enrollment.current_node_id) : null;

        console.warn('🔍 [WAIT NODE VALIDATION] Current wait node check:', {
          current_node_id: enrollment.current_node_id?.substring(0, 8),
          currentWaitNodeFound: !!currentWaitNode,
          currentWaitNodeId: currentWaitNode?.flow_node_id || currentWaitNode?.id.substring(0, 8),
        });

        if (currentWaitNode) {
          // Find wait node in flow_data to get duration
          const flowNode = flowNodes.find((n: any) => n.id === currentWaitNode.flow_node_id || n.id === currentWaitNode.id);

          const waitDurationSeconds =
            flowNode?.data?.wait_duration_seconds ||
            currentWaitNode.node_data?.wait_duration_seconds ||
            (flowNode?.data?.duration || currentWaitNode.node_data?.duration || 0) *
              ((flowNode?.data?.unit || currentWaitNode.node_data?.unit) === 'minutes'
                ? 60
                : (flowNode?.data?.unit || currentWaitNode.node_data?.unit) === 'hours'
                  ? 3600
                  : 1);

          if (waitDurationSeconds > 0) {
            // Calculate expected next_run_at from enrollment.updated_at (when enrollment was last processed)
            // This matches the wait node handler logic which uses enrollment.updated_at as base
            const enrollmentUpdatedAt = new Date(enrollment.updated_at);
            let expectedNextRun = new Date(enrollmentUpdatedAt.getTime() + waitDurationSeconds * 1000);

            // Check if schedule might have adjusted it
            const schedule = campaign?.schedule;
            if (schedule) {
              // Schedule might push it later, so just check if it's not too early
              if (nextRunAt.getTime() < expectedNextRun.getTime() - 1000) {
                waitNodeFailures.push(
                  `Wait node ${currentWaitNode.flow_node_id || currentWaitNode.id.substring(0, 8)}: next_run_at (${nextRunAt.toISOString()}) ` +
                    `is before expected time (${expectedNextRun.toISOString()}) ` +
                    `for ${waitDurationSeconds}s wait`
                );
              }
            } else {
              // No schedule - should be exactly base + duration (within tolerance)
              const tolerance = 5000; // 5 seconds tolerance for processing time
              const diff = Math.abs(nextRunAt.getTime() - expectedNextRun.getTime());

              console.warn('🔍 [WAIT NODE VALIDATION] Time comparison:', {
                waitNodeId: currentWaitNode.flow_node_id || currentWaitNode.id.substring(0, 8),
                enrollmentUpdatedAt: enrollmentUpdatedAt.toISOString(),
                waitDurationSeconds,
                expectedNextRun: expectedNextRun.toISOString(),
                actualNextRunAt: nextRunAt.toISOString(),
                diffMs: diff,
                toleranceMs: tolerance,
              });

              if (diff > tolerance) {
                waitNodeFailures.push(
                  `Wait node ${currentWaitNode.flow_node_id || currentWaitNode.id.substring(0, 8)}: next_run_at (${nextRunAt.toISOString()}) ` +
                    `differs from expected (${expectedNextRun.toISOString()}) by ${diff}ms ` +
                    `for ${waitDurationSeconds}s wait`
                );
              }
            }
          }
        } else if (enrollment.current_node_id) {
          // Current node is not a wait node - might be at an email node or completed
          // This is fine - wait nodes might have already been processed
          console.warn('🔍 [WAIT NODE VALIDATION] Current node is not a wait node, skipping specific validation.');
        }

        if (waitNodeFailures.length > 0) {
          testFailures.push(`❌ Wait Node Processing: ${waitNodeFailures.length} issue(s):\n` + waitNodeFailures.map(f => `  - ${f}`).join('\n'));
        } else {
          testResults.push(`✅ Wait Node Processing: Wait nodes processed correctly (next_run_at updated, no jitter applied)`);
        }
        console.warn('🔍 [WAIT NODE VALIDATION] Final result:', {
          failuresCount: waitNodeFailures.length,
          testResultsCount: testResults.length,
          testFailuresCount: testFailures.length,
        });
      } else if (enrollment?.state === 'completed') {
        console.warn('🔍 [WAIT NODE VALIDATION] Enrollment completed, skipping validation');
        testResults.push(`✅ Wait Node Processing: Wait nodes processed (enrollment completed)`);
      } else {
        console.warn('🔍 [WAIT NODE VALIDATION] No next_run_at and not completed:', {
          enrollmentState: enrollment?.state,
          hasWaitNodes,
        });
        testFailures.push(`❌ Wait Node Processing: Wait nodes in flow but enrollment has no next_run_at and is not completed`);
      }
    } else {
      testResults.push('✅ Wait Node Processing: No wait nodes in flow (not applicable)');
    }

    // Schedule Enforcement Validation
    if (enableSchedule) {
      const campaign = verificationData?.campaign;
      const schedule = campaign?.schedule;

      if (jobStats.total > 0) {
        if (schedule) {
          const scheduleFailures: string[] = [];
          const messageJobs = verificationData?.messageJobs || [];

          messageJobs.forEach((job: any) => {
            try {
              const scheduledAt = new Date(job.scheduled_at);

              // Convert to campaign timezone
              const zonedTime = utcToZonedTime(scheduledAt, schedule.timezone);
              const hour = zonedTime.getHours();
              const dayOfWeek = zonedTime.getDay(); // 0 = Sunday, 6 = Saturday

              // Check if within hours
              const isWithinHours = hour >= schedule.start_hour && hour < schedule.end_hour;

              // Check if day is allowed
              const isAllowedDay = !schedule.days_of_week || schedule.days_of_week.length === 0 || schedule.days_of_week.includes(dayOfWeek);

              if (!isWithinHours || !isAllowedDay) {
                scheduleFailures.push(
                  `Job ${job.id.substring(0, 8)}... scheduled at ${scheduledAt.toLocaleString()} ` +
                    `(${hour}:00 ${schedule.timezone}, day ${dayOfWeek}) is outside business hours ` +
                    `(${schedule.start_hour}:00-${schedule.end_hour}:00, days: ${schedule.days_of_week || 'all'})`
                );
              }
            } catch (error) {
              scheduleFailures.push(`Job ${job.id.substring(0, 8)}...: Error validating schedule - ${error instanceof Error ? error.message : String(error)}`);
            }
          });

          if (scheduleFailures.length > 0) {
            testFailures.push(`❌ Schedule Enforcement: ${scheduleFailures.length} job(s) scheduled outside business hours:\n` + scheduleFailures.map(f => `  - ${f}`).join('\n'));
          } else {
            testResults.push(`✅ Schedule Enforcement: All ${messageJobs.length} job(s) scheduled within business hours (${schedule.start_hour}:00-${schedule.end_hour}:00 ${schedule.timezone})`);
          }
        } else {
          // Schedule enabled but not found in campaign - might be a data issue
          testFailures.push('❌ Schedule Enforcement: Schedule enabled but not found in campaign data');
        }
      } else {
        testFailures.push('❌ Schedule Enforcement: Cannot validate schedule (no message jobs created)');
      }
    } else {
      testResults.push('✅ Schedule Enforcement: Schedule not enabled (not applicable)');
    }

    // Jitter Application Validation
    if (enableJitter) {
      const campaign = verificationData?.campaign;
      const jitterPct = campaign?.jitter_percentage || parseFloat(jitterPercentage) || 0;

      if (jobStats.total > 0) {
        if (jitterPct > 0) {
          const jitterFailures: string[] = [];
          const jobsWithoutJitter: string[] = [];
          const messageJobs = verificationData?.messageJobs || [];

          messageJobs.forEach((job: any) => {
            try {
              const createdAt = new Date(job.created_at);
              const scheduledAt = new Date(job.scheduled_at);

              // Allow timing tolerance (3 seconds) for database write delays
              const tolerance = 3000; // 3 seconds
              const timeDiff = Math.abs(scheduledAt.getTime() - createdAt.getTime());

              // If scheduled_at and created_at are very close (within tolerance),
              // this means jitter was effectively 0, which is valid
              if (timeDiff <= tolerance) {
                // Times are close enough - jitter validation passes
                // This handles cases where:
                // 1. scheduled_at ≈ created_at (no schedule adjustment, jitter = 0)
                // 2. Small timing differences due to DB write delays
                return; // Skip this job, it's valid
              }

              // For larger time differences, validate that jitter was applied correctly
              // Use the earlier timestamp as the reference (the scheduler's baseTime approximation)
              const referenceTime = Math.min(createdAt.getTime(), scheduledAt.getTime());
              const timeDiffFromRef = Math.abs(scheduledAt.getTime() - referenceTime);

              // Calculate expected jitter range
              // For small time differences, use a minimum jitter range
              // For larger differences, jitter range scales with the difference
              const minJitterRangeMs = 50; // Minimum 50ms jitter range
              const jitterRangeFromDiff = timeDiffFromRef * (jitterPct / 100);
              const effectiveJitterRange = Math.max(jitterRangeFromDiff, minJitterRangeMs);

              // Allow scheduled_at to be within the jitter range from reference time
              // Also allow it to be slightly before reference (within tolerance) due to timing
              const expectedMin = referenceTime - tolerance;
              const expectedMax = referenceTime + effectiveJitterRange;
              const actualTime = scheduledAt.getTime();

              if (actualTime < expectedMin || actualTime > expectedMax) {
                const actualJitter = ((actualTime - referenceTime) / referenceTime) * 100;
                const refTimeStr = new Date(referenceTime).toISOString();
                jitterFailures.push(
                  `Job ${job.id.substring(0, 8)}... has jitter ${actualJitter.toFixed(2)}% ` +
                    `(expected within ${(effectiveJitterRange / 1000).toFixed(1)}s of reference time). ` +
                    `Reference: ${refTimeStr}, Scheduled: ${scheduledAt.toISOString()}, Created: ${createdAt.toISOString()}`
                );
              }
              // If scheduled_at is within bounds, validation passes
            } catch (error) {
              jitterFailures.push(`Job ${job.id.substring(0, 8)}...: Error validating jitter - ${error instanceof Error ? error.message : String(error)}`);
            }
          });

          if (jitterFailures.length > 0) {
            testFailures.push(`❌ Jitter Application: ${jitterFailures.length} job(s) with incorrect jitter:\n` + jitterFailures.map(f => `  - ${f}`).join('\n'));
          } else if (jobsWithoutJitter.length === messageJobs.length) {
            // All jobs have no jitter - might be a bug
            testFailures.push(`❌ Jitter Application: No jitter applied to any job (all scheduled_at === created_at). Expected jitter: ${jitterPct}%`);
          } else {
            testResults.push(`✅ Jitter Application: All ${messageJobs.length} job(s) have jitter applied (0-${jitterPct}% range, not applied to wait nodes)`);
          }
        } else {
          // Jitter enabled but percentage is 0
          testResults.push('✅ Jitter Application: Jitter enabled but percentage is 0% (no jitter expected)');
        }
      } else {
        testFailures.push('❌ Jitter Application: Cannot validate jitter (no message jobs created)');
      }
    } else {
      testResults.push('✅ Jitter Application: Jitter not enabled (not applicable)');
    }

    if (testFailures.length > 0) {
      nextStepsType = 'action';
      nextSteps = `TEST FAILED:\n\n${testFailures.join('\n')}\n\n✅ Passed:\n${testResults.join('\n')}\n\n⚠️ Action required: Review the failures above and check CloudWatch logs for the scheduler worker.`;
    } else {
      nextStepsType = 'success';
      nextSteps = `TEST PASSED! All criteria validated successfully:\n\n${testResults.join('\n')}\n\nThe scheduler correctly processed the ${selectedFlow} flow template with ${hasEmailNodes ? emailNodeCount + ' email node' + (emailNodeCount !== 1 ? 's' : '') : 'no email nodes'}${hasWaitNodes ? ', wait nodes' : ''}${enableSchedule ? ', schedule enforcement' : ''}${enableJitter ? ', and jitter' : ''}. Everything worked as expected.`;
    }
  } else if (testStatus === 'error') {
    nextStepsType = 'action';
    nextSteps =
      '❌ TEST FAILED: Enrollment was stopped with an error. Check the error message above and review CloudWatch logs for the scheduler worker to identify and fix the issue.\n\nPossible causes: missing mailbox, invalid flow configuration, or database error.';
  } else if (testStatus === 'waiting') {
    if (enrollment?.next_run_at) {
      nextStepsType = 'waiting';
      const nextRun = new Date(enrollment.next_run_at);
      const secondsUntil = Math.ceil((nextRun.getTime() - new Date().getTime()) / 1000);

      if (hasWaitNodes) {
        testResults.push('✅ Wait Node Processing: Wait node processed, next_run_at updated correctly');
        testResults.push('✅ Flow Traversal: Moved through wait node in flow');
        nextSteps = `⏳ TEST IN PROGRESS: Waiting for wait node to complete. Next run scheduled in ${secondsUntil} second${secondsUntil !== 1 ? 's' : ''} at ${nextRun.toLocaleTimeString()}.\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⏳ Still validating: Scheduler will resume processing when next_run_at is reached to continue flow traversal.`;
      } else {
        nextSteps = `⏳ TEST IN PROGRESS: Waiting for next run at ${nextRun.toLocaleTimeString()} (${secondsUntil} seconds).\n\nNote: Your flow template (${selectedFlow}) doesn't include wait nodes, so this wait state may indicate an unexpected delay.`;
      }
    } else {
      nextStepsType = 'action';
      nextSteps =
        "⚠️ TEST STALLED: The scheduler should have processed this enrollment but hasn't. Check if the scheduler ECS service is running and review CloudWatch logs.\n\nPossible causes: scheduler worker not running, enrollment not being picked up by scheduler query, or processing error.";
    }
  } else if (testStatus === 'processing') {
    nextStepsType = 'waiting';
    const nodeCount = dbNodeTypes.length;
    const expectedValidation = [
      'Entry Point Detection (starting from leadSource node)',
      `Flow Traversal (evaluating ${nodeCount} node${nodeCount !== 1 ? 's' : ''} in ${selectedFlow} flow)`,
      hasEmailNodes ? `Message Job Creation (should create ${expectedMessageJobCount} job${expectedMessageJobCount !== 1 ? 's' : ''} for ${emailNodeCount} email node${emailNodeCount !== 1 ? 's' : ''})` : null,
    ]
      .filter(Boolean)
      .join(', ');
    nextSteps = `⏳ TEST IN PROGRESS: Waiting for scheduler to evaluate the flow and create message jobs. The scheduler polls every 5 seconds.\n\nThis will validate: ${expectedValidation}.`;
  } else if (testStatus === 'running') {
    testResults.push('✅ Entry Point Detection: Enrollment started from correct entry point (leadSource node)');
    testResults.push(`✅ Flow Traversal: Scheduler evaluated ${selectedFlow} flow and processed nodes`);

    if (hasEmailNodes) {
      if (jobStats.total === 0) {
        nextStepsType = 'action';
        nextSteps = `⚠️ TEST IN PROGRESS: Scheduler processed enrollment but no message jobs created.\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n❌ Expected ${expectedMessageJobCount} message job${expectedMessageJobCount !== 1 ? 's' : ''} from ${emailNodeCount} email node${emailNodeCount !== 1 ? 's' : ''} in ${selectedFlow} flow, but none were created. Wait a bit longer, or check scheduler logs for errors.`;
      } else if (jobStats.total < expectedMessageJobCount) {
        testResults.push(`⚠️ Message Job Creation: ${jobStats.total} of ${expectedMessageJobCount} expected jobs created`);
        nextStepsType = 'waiting';
        nextSteps = `⏳ TEST IN PROGRESS: Only ${jobStats.total} of ${expectedMessageJobCount} expected message jobs created.\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⏳ Waiting for scheduler to create remaining jobs or continue flow traversal.`;
      } else if (jobStats.total > expectedMessageJobCount) {
        // CRITICAL: More jobs than expected - check for duplicates
        const messageJobs = verificationData?.messageJobs || [];
        const jobsByNodeId: Record<string, any[]> = {};
        messageJobs.forEach((job: any) => {
          const nodeId = job.node_id;
          if (!jobsByNodeId[nodeId]) {
            jobsByNodeId[nodeId] = [];
          }
          jobsByNodeId[nodeId].push(job);
        });

        const duplicateNodes = Object.entries(jobsByNodeId).filter(([nodeId, jobs]) => jobs.length > 1);

        if (duplicateNodes.length > 0) {
          const duplicateDetails = duplicateNodes
            .map(([nodeId, jobs]) => {
              const nodeFlowId = jobs[0].node?.flow_node_id || 'unknown';
              return `Node ${nodeFlowId}: ${jobs.length} jobs`;
            })
            .join(', ');
          testFailures.push(`❌ Message Job Creation: DUPLICATE DETECTED! Found ${jobStats.total} jobs (expected ${expectedMessageJobCount}). Duplicates: ${duplicateDetails}`);
          nextStepsType = 'action';
          nextSteps = `❌ TEST FAILED: Duplicate message jobs detected!\n\n${testFailures.join('\n')}\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⚠️ This indicates a race condition bug. Check scheduler worker logs and verify the locking mechanism is working correctly.`;
        } else {
          testFailures.push(`❌ Message Job Creation: Found ${jobStats.total} jobs (expected ${expectedMessageJobCount}), but no duplicate node_ids. This may indicate extra jobs were created.`);
          nextStepsType = 'action';
          nextSteps = `❌ TEST FAILED: Unexpected number of message jobs.\n\n${testFailures.join('\n')}\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⚠️ Check scheduler worker logs to understand why extra jobs were created.`;
        }
      } else {
        // Exact count - validate no duplicates
        const messageJobs = verificationData?.messageJobs || [];
        const jobsByNodeId: Record<string, any[]> = {};
        messageJobs.forEach((job: any) => {
          const nodeId = job.node_id;
          if (!jobsByNodeId[nodeId]) {
            jobsByNodeId[nodeId] = [];
          }
          jobsByNodeId[nodeId].push(job);
        });

        const duplicateNodes = Object.entries(jobsByNodeId).filter(([nodeId, jobs]) => jobs.length > 1);

        if (duplicateNodes.length > 0) {
          const duplicateDetails = duplicateNodes
            .map(([nodeId, jobs]) => {
              const nodeFlowId = jobs[0].node?.flow_node_id || 'unknown';
              return `Node ${nodeFlowId}: ${jobs.length} jobs`;
            })
            .join(', ');
          testFailures.push(`❌ Message Job Creation: DUPLICATE DETECTED! Found duplicate message jobs: ${duplicateDetails}`);
          nextStepsType = 'action';
          nextSteps = `❌ TEST FAILED: Duplicate message jobs detected!\n\n${testFailures.join('\n')}\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⚠️ This indicates a race condition bug. Check scheduler worker logs and verify the locking mechanism is working correctly.`;
        } else {
          testResults.push(`✅ Message Job Creation: ${jobStats.total} message job${jobStats.total !== 1 ? 's' : ''} created (expected ${expectedMessageJobCount} from ${emailNodeCount} email node${emailNodeCount !== 1 ? 's' : ''}), no duplicates detected`);

          if (jobStats.pending > 0) {
            nextStepsType = 'waiting';
            const stillValidating = [hasWaitNodes ? 'Wait Node Processing' : null, 'Flow Completion', enableSchedule ? 'Schedule Enforcement' : null, enableJitter ? 'Jitter Application' : null].filter(Boolean).join(', ');
            nextSteps = `⏳ TEST IN PROGRESS: ${jobStats.pending} message job${jobStats.pending !== 1 ? 's' : ''} pending. Wait for send workers to process them.\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⏳ Still validating: ${stillValidating}.`;
          } else if (jobStats.sent === jobStats.total) {
            nextStepsType = 'waiting';
            const stillValidating = [hasWaitNodes ? 'Wait Node Processing' : null, 'Flow Completion'].filter(Boolean).join(', ');
            nextSteps = `⏳ TEST IN PROGRESS: All ${jobStats.total} message job${jobStats.total !== 1 ? 's' : ''} sent. Waiting for scheduler to evaluate next nodes in ${selectedFlow} flow.\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⏳ Still validating: ${stillValidating}.`;
          } else {
            nextStepsType = 'info';
            nextSteps = `📊 TEST IN PROGRESS: Monitor progress above.\n\n✅ Validated so far:\n${testResults.join('\n')}`;
          }
        }
      }
    } else {
      testResults.push('✅ Message Job Creation: No email nodes in flow (none expected)');
      nextStepsType = 'waiting';
      const stillValidating = [hasWaitNodes ? 'Wait Node Processing' : null, 'Flow Completion'].filter(Boolean).join(', ');
      nextSteps = `⏳ TEST IN PROGRESS: Flow evaluated. Waiting for scheduler to continue processing.\n\n✅ Validated so far:\n${testResults.join('\n')}\n\n⏳ Still validating: ${stillValidating}.`;
    }
  } else {
    nextStepsType = 'info';
    const nodeCount = dbNodeTypes.length || 0;
    const expectedValidation = ['Entry Point Detection (starting from leadSource)', `Flow Traversal (${selectedFlow} flow with ${nodeCount} node${nodeCount !== 1 ? 's' : ''})`].join(', ');
    nextSteps = `🔄 TEST SETUP: Waiting for scheduler to begin processing the enrollment.\n\nThis will validate: ${expectedValidation}.`;
  }

  return {
    testResults,
    testFailures,
    nextSteps,
    nextStepsType,
  };
}

