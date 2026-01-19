# Common CDK IAM Policy Approaches

Security tools will warn about CDK policies because infrastructure-as-code tools need broad permissions. Here are how teams typically handle this:

## Option 1: Accept Warnings (Most Common) ⭐

**Reality:** CDK needs broad permissions. Many teams:
- Accept the security warnings as necessary
- Monitor deployments via CloudTrail
- Use separate deployment roles (not personal users)
- Scope access to specific AWS accounts/regions

**Why:** CDK creates infrastructure dynamically - you can't pre-scope ARNs for resources that don't exist yet.

## Option 2: Use Separate Deployment Role

Instead of giving the user broad permissions:

1. **Create a deployment role:**
   ```bash
   # Admin creates a role with broad permissions
   # Users assume the role only during deployments
   ```

2. **Users assume role when deploying:**
   ```bash
   aws sts assume-role --role-arn arn:aws:iam::686255981838:role/CDKDeploymentRole
   export AWS_PROFILE=deployment
   cdk deploy
   ```

**Pros:** Limits scope, clearer audit trail
**Cons:** More setup, requires admin to create role initially

## Option 3: Use Managed Policies + Conditions

Use AWS managed policies with additional conditions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ec2:*",
        "ecs:*",
        "ecr:*"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "us-west-2"
        },
        "DateGreaterThan": {
          "aws:CurrentTime": "2024-01-01T00:00:00Z"
        }
      }
    }
  ]
}
```

## Option 4: Hybrid Approach (Recommended for Dev)

For development accounts, many teams use:

- **Broad service permissions** (`ecs:*`, `ec2:*`, etc.) with `Resource: "*"`
- **Scoped to specific account/region** via conditions
- **Separate prod role** with tighter restrictions

## What We're Using

We're using **Option 1 + Scoped Resources where possible**:

- ✅ IAM roles scoped to `cdk-*` and `WorkerStack-*` patterns
- ✅ ECR scoped to `furnace/*` repositories  
- ✅ SSM scoped to `/amplify/*` parameters
- ⚠️ CloudFormation, ECS, EC2, CloudWatch use `*` (required for CDK)

**Why this is okay:**
1. Single AWS account (686255981838)
2. Single region (us-west-2)
3. Dedicated deployment user (`amplify-dev`)
4. CloudTrail logs all actions
5. Only used during deployments (not continuous)

## Security Best Practices

1. **Monitor via CloudTrail:** All CDK actions are logged
2. **Separate dev/prod:** Use different roles/users
3. **Time-limited:** Use role assumption with session duration
4. **MFA:** Require MFA for deployment user
5. **Audit regularly:** Review CloudTrail logs monthly

## If Security Team Requires Stricter Policy

If you must remove all warnings, you'd need:
- Pre-create all resources
- Use specific ARNs for everything
- But then you lose CDK's dynamic resource creation benefits

**Bottom line:** Security warnings for CDK are normal and expected. The important thing is:
- ✅ Separate deployment credentials
- ✅ Monitor via CloudTrail  
- ✅ Scope what you can (account, region, resource patterns)
- ✅ Accept that infrastructure tools need broad permissions


