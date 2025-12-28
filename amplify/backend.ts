import { defineBackend } from '@aws-amplify/backend';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { auth } from './auth/resource';
import { data } from './data/resource';
import { sendInvitationEmail } from './functions/sendInvitationEmail/resource';
import { scheduler } from './functions/scheduler/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  data,
  sendInvitationEmail,
  scheduler,
});

// Grant scheduler Lambda permission to send messages to SQS queue
// Queue ARN: arn:aws:sqs:us-west-2:686255981838:furnace-send-queue
const schedulerLambda = backend.scheduler.resources.lambda;

const sqsPolicyStatement = new iam.PolicyStatement({
  sid: 'AllowSendMessageToSendQueue',
  actions: [
    'sqs:SendMessage',
    'sqs:GetQueueUrl',
    'sqs:GetQueueAttributes',
  ],
  resources: ['arn:aws:sqs:us-west-2:686255981838:furnace-send-queue'],
});

schedulerLambda.addToRolePolicy(sqsPolicyStatement);

// Create ECR repository for send worker Docker images
const sendWorkerRepo = new ecr.Repository(backend.stack, 'SendWorkerRepo', {
  repositoryName: 'furnace/send-worker',
  imageScanOnPush: true,
  lifecycleRules: [
    {
      maxImageCount: 10, // Keep last 10 images
    },
  ],
});
