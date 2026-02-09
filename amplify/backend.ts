import { config } from 'dotenv';
import { defineBackend } from '@aws-amplify/backend';

// Load .env.local so EXPO_PUBLIC_SUPABASE_URL is available for Lambdas at synth time
config({ path: '.env.local' });
config();
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { sendInvitationEmail } from './functions/sendInvitationEmail/resource';
import { inboxChecker } from './functions/inboxChecker/resource';
import { enrollmentMetric } from './functions/enrollmentMetric/resource';
import { fetchEmailAttachment } from './functions/fetchEmailAttachment/resource';

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
  fetchEmailAttachment,
});

// Fetch email attachment: Function URL + Cognito env for JWT verification
const fetchAttachmentLambda = backend.fetchEmailAttachment.resources.lambda as lambda.Function;
const authResources = backend.auth.resources;
fetchAttachmentLambda.addEnvironment('COGNITO_USER_POOL_ID', authResources.userPool.userPoolId);
fetchAttachmentLambda.addEnvironment('COGNITO_CLIENT_ID', authResources.userPoolClient.userPoolClientId);
fetchAttachmentLambda.addEnvironment('SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL ?? '');
const fetchAttachmentUrl = fetchAttachmentLambda.addFunctionUrl({
  authType: lambda.FunctionUrlAuthType.NONE, // We validate JWT inside the handler
  cors: {
    allowedOrigins: ['*'],
    allowedMethods: [lambda.HttpMethod.GET, lambda.HttpMethod.POST],
    allowedHeaders: ['Authorization', 'Content-Type'],
  },
});
// With authType NONE, the resource-based policy must explicitly allow public invocation.
// Use CfnPermission directly since addPermission doesn't support Principal "*"
new lambda.CfnPermission(fetchAttachmentLambda.stack, 'AllowPublicFunctionUrlInvoke', {
  action: 'lambda:InvokeFunctionUrl',
  functionName: fetchAttachmentLambda.functionName,
  principal: '*',
  functionUrlAuthType: 'NONE',
});
// As of Oct 2025, Function URLs also require lambda:InvokeFunction permission.
// Keep this scoped to Function URL invocations via explicit CFN override.
const allowPublicInvokeViaUrl = new lambda.CfnPermission(fetchAttachmentLambda.stack, 'AllowPublicInvokeViaFunctionUrl', {
  action: 'lambda:InvokeFunction',
  functionName: fetchAttachmentLambda.functionName,
  principal: '*',
});
allowPublicInvokeViaUrl.addPropertyOverride('InvokedViaFunctionUrl', true);
backend.addOutput({
  custom: {
    fetchEmailAttachmentUrl: fetchAttachmentUrl.url,
  },
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
