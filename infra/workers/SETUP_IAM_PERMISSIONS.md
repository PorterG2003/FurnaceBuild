# Setting Up IAM Permissions for CDK

The `amplify-dev` IAM user needs additional permissions to bootstrap and deploy CDK stacks.

**Note:** AWS limits IAM entities to 10 managed policies. If you hit this limit, use a single custom policy instead.

## Quick Solution: AdministratorAccess (Easiest)

If you're hitting policy quota limits, just attach one policy:

1. Go to IAM Console → Users → `amplify-dev`
2. Click "Add permissions" → "Attach policies directly"
3. Search for `AdministratorAccess`
4. Select and attach

This gives all permissions needed for CDK in a single policy.

## Option 1: Attach Custom Policy via AWS Console

1. **Go to IAM Console:**
   - Navigate to: https://console.aws.amazon.com/iam/
   - Click "Users" → Find `amplify-dev`

2. **Add Permissions:**
   - Click "Add permissions" → "Attach policies directly"
   - Click "Create policy"
   - Click "JSON" tab
   - Copy the contents of `cdk-iam-policy-single.json` (or `cdk-iam-policy.json` for more restrictive)
   - Paste into the JSON editor
   - Click "Next"
   - Name: `CDKDeploymentPolicy`
   - Description: "Permissions for CDK bootstrap and deployment"
   - Click "Create policy"

3. **Attach Policy to User:**
   - Go back to `amplify-dev` user
   - Click "Add permissions" → "Attach policies directly"
   - Search for `CDKDeploymentPolicy`
   - Select it and click "Add permissions"

## Option 2: Create and Attach Custom Policy via AWS CLI

If you hit the 10 managed policy limit, create a single custom policy:

```bash
# Create the policy (single combined policy)
aws iam create-policy \
  --policy-name CDKDeploymentPolicy \
  --policy-document file://infra/workers/cdk-iam-policy-single.json \
  --description "Combined permissions for CDK bootstrap and deployment"

# Note the PolicyArn from the output, then attach it:
aws iam attach-user-policy \
  --user-name amplify-dev \
  --policy-arn arn:aws:iam::686255981838:policy/CDKDeploymentPolicy
```

**Or if you prefer the more restrictive version:**
```bash
aws iam create-policy \
  --policy-name CDKDeploymentPolicy \
  --policy-document file://infra/workers/cdk-iam-policy.json \
  --description "Scoped permissions for CDK bootstrap and deployment"
```

## Option 3: Use AdministratorAccess (Simplest - Single Policy)

If you have admin access, you can temporarily grant AdministratorAccess:

```bash
aws iam attach-user-policy \
  --user-name amplify-dev \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

**Note:** This is less secure but useful for development. Consider using the custom policy for production.

## Verify Permissions

After attaching the policy, verify it works:

```bash
cd infra/workers
cdk bootstrap aws://686255981838/us-west-2
```

## Policy Breakdown

The policy includes permissions for:

- **CloudFormation:** Full access (create, update, delete stacks)
- **S3:** CDK bootstrap bucket operations
- **IAM:** Create/manage roles for ECS tasks
- **ECR:** Docker image repository operations
- **ECS:** Container service deployment
- **EC2/VPC:** Network infrastructure
- **CloudWatch Logs:** Log group creation
- **SSM Parameter Store:** Read Supabase service keys

## Security Notes

- The policy is scoped to your account (686255981838)
- SSM permissions are limited to `/amplify/*` paths
- Consider further restricting S3 bucket names if needed
- For production, use least-privilege principles

