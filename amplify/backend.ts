import { defineBackend } from '@aws-amplify/backend';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { sendInvitationEmail } from './functions/sendInvitationEmail/resource';
import { inboxChecker } from './functions/inboxChecker/resource';
import { enrollmentMetric } from './functions/enrollmentMetric/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 * 
 * Note: ECS workers have been moved to a separate CDK stack in infra/workers/
 * This keeps Amplify deployments fast and avoids CloudFormation timeout issues.
 */
const backend = defineBackend({
  auth,
  data,
  sendInvitationEmail,
  inboxChecker,
  enrollmentMetric,
});

// Grant enrollmentMetric Lambda permission to publish CloudWatch metrics
// This can still be useful for monitoring, even though scheduler auto-scaling is handled separately
const enrollmentMetricLambda = backend.enrollmentMetric.resources.lambda;
enrollmentMetricLambda.addToRolePolicy(new iam.PolicyStatement({
  sid: 'AllowCloudWatchPutMetricData',
  actions: [
    'cloudwatch:PutMetricData',
  ],
  resources: ['*'], // PutMetricData requires '*' resource
}));
