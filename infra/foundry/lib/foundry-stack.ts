import * as cdk from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import type { Construct } from 'constructs';

export interface FoundryStackProps extends cdk.StackProps {
  /** Used in stub state machine names (e.g. dev / prod). */
  environment: string;
}

/**
 * Phase 2/3 stub state machines only. Normalize ingestion runs on Amplify
 * (`foundryNormalizeJob` + Step Functions in amplify/backend.ts).
 */
export class FoundryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FoundryStackProps) {
    super(scope, id, props);

    const bulkStubDef = new sfn.Pass(this, 'BulkResolveStubPlaceholder', {
      comment: 'Phase 2: bulk_source_resolution chunk loop',
    }).next(new sfn.Succeed(this, 'BulkResolveStubDone'));

    const bulkStubSm = new sfn.StateMachine(this, 'BulkSourceResolutionStubSm', {
      stateMachineName: `foundry-bulk-resolve-stub-${props.environment}`,
      definitionBody: sfn.DefinitionBody.fromChainable(bulkStubDef),
    });

    const stateMatchStubDef = new sfn.Pass(this, 'StateMatchStubPlaceholder', {
      comment: 'Phase 3: state_matching_batch orchestration + ECS connector',
    }).next(new sfn.Succeed(this, 'StateMatchStubDone'));

    const stateMatchStubSm = new sfn.StateMachine(this, 'StateMatchingStubSm', {
      stateMachineName: `foundry-state-match-stub-${props.environment}`,
      definitionBody: sfn.DefinitionBody.fromChainable(stateMatchStubDef),
    });

    new cdk.CfnOutput(this, 'BulkResolveStubStateMachineArn', {
      value: bulkStubSm.stateMachineArn,
      exportName: `FoundryBulkResolveStubSmArn-${props.environment}`,
    });

    new cdk.CfnOutput(this, 'StateMatchingStubStateMachineArn', {
      value: stateMatchStubSm.stateMachineArn,
      exportName: `FoundryStateMatchStubSmArn-${props.environment}`,
    });
  }
}
