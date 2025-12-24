# AWS Access Grants - Configuration Setup Guide

This guide will help you configure the AWS Access Grants CLI tool with your actual Azure AD and AWS credentials.

## Prerequisites

Before you begin, ensure you have:
- ✅ Azure AD tenant with administrative access
- ✅ AWS Organization with IAM Identity Center enabled
- ✅ Azure AD integrated with AWS IAM Identity Center (SSO configured)

## Step 1: Azure AD Configuration

### 1.1 Get Azure Tenant ID
1. Go to [Azure Portal](https://portal.azure.com)
2. Navigate to **Azure Active Directory**
3. Go to **Properties**
4. Copy the **Tenant ID**
5. Update `AZURE_TENANT_ID` in your `.env` file

### 1.2 Create Azure AD Application (Service Principal)
1. In Azure AD, go to **App registrations**
2. Click **New registration**
3. Name: `AWS-Access-Grants-CLI`
4. Account types: **Accounts in this organizational directory only**
5. Click **Register**
6. Copy the **Application (client) ID** → Update `AZURE_CLIENT_ID`

### 1.3 Create Client Secret
1. In your app registration, go to **Certificates & secrets**
2. Click **New client secret**
3. Description: `CLI Tool Secret`
4. Expires: Choose appropriate duration (12-24 months recommended)
5. Click **Add**
6. Copy the **Value** (not the Secret ID) → Update `AZURE_CLIENT_SECRET`
   ⚠️ **Important**: Copy this immediately - you won't see it again!

### 1.4 Configure API Permissions
Your service principal needs these Microsoft Graph permissions:
1. Go to **API permissions**
2. Click **Add a permission** → **Microsoft Graph** → **Application permissions**
3. Add these permissions:
   - `Group.ReadWrite.All` - Create and manage security groups
   - `User.Read.All` - Read user information for validation
   - `Application.ReadWrite.All` - Manage enterprise application assignments
4. Click **Grant admin consent** (requires Global Admin)

### 1.5 Get Enterprise Application ID
1. Go to **Enterprise applications**
2. Search for your AWS IAM Identity Center application
3. Click on it and go to **Properties**
4. Copy the **Object ID** → Update `AZURE_ENTERPRISE_APP_ID`

## Step 2: AWS Configuration

### 2.1 Get AWS Region
- Use the region where your IAM Identity Center is deployed
- Common regions: `us-east-1`, `us-west-2`, `eu-west-1`
- Update `AWS_REGION`

### 2.2 Get Identity Center Instance ARN
1. Go to [AWS IAM Identity Center Console](https://console.aws.amazon.com/singlesignon)
2. Go to **Settings**
3. Copy the **Instance ARN**
   - Format: `arn:aws:sso:::instance/ssoins-xxxxxxxxxxxxxxxxx`
4. Update `AWS_IDENTITY_CENTER_INSTANCE_ARN`

### 2.3 Get Identity Store ID
1. In IAM Identity Center, go to **Settings**
2. Copy the **Identity store ID**
   - Format: `d-xxxxxxxxxx`
3. Update `AWS_IDENTITY_STORE_ID`

### 2.4 Configure Account Mapping
Map your account types to actual AWS account IDs:
1. Go to [AWS Organizations Console](https://console.aws.amazon.com/organizations)
2. Note down your account IDs for each environment
3. Update the account mapping in `.env`:
   ```bash
   AWS_ACCOUNT_DEV=123456789012      # Your Dev account ID
   AWS_ACCOUNT_QA=234567890123       # Your QA account ID
   AWS_ACCOUNT_STAGING=345678901234  # Your Staging account ID
   AWS_ACCOUNT_PROD=456789012345     # Your Production account ID
   ```

## Step 3: AWS Credentials Setup

The tool uses AWS SDK and supports AWS profiles from your `~/.aws/credentials` file. This is the recommended approach for credential management.

### Option A: AWS Profile (Recommended)
1. **Configure AWS CLI** (if not already done):
   ```bash
   aws configure --profile your-profile-name
   # Enter your AWS Access Key ID
   # Enter your AWS Secret Access Key
   # Enter your default region
   ```

2. **Set the profile in your `.env` file**:
   ```bash
   AWS_PROFILE=your-profile-name
   ```

3. **Use default profile** (if you want to use the default profile):
   ```bash
   AWS_PROFILE=default
   # or simply omit this line to use default
   ```

### Option B: Environment Variables (Alternative)
If you prefer not to use profiles, you can still set credentials directly:
```bash
AWS_ACCESS_KEY_ID=your-access-key-id
AWS_SECRET_ACCESS_KEY=your-secret-access-key
```

### Option C: IAM Role (for EC2/Lambda)
If running on AWS infrastructure, use IAM roles instead of keys.

### Verify Your AWS Profile
You can test your AWS profile configuration:
```bash
# Test with specific profile
aws sts get-caller-identity --profile your-profile-name

# Test with default profile
aws sts get-caller-identity
```

## Step 4: Required AWS Permissions

Your AWS credentials need these permissions:

### IAM Identity Center Permissions
```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "sso:ListInstances",
                "sso:ListPermissionSets",
                "sso:CreatePermissionSet",
                "sso:DeletePermissionSet",
                "sso:DescribePermissionSet",
                "sso:AttachManagedPolicyToPermissionSet",
                "sso:DetachManagedPolicyFromPermissionSet",
                "sso:PutInlinePolicyToPermissionSet",
                "sso:DeleteInlinePolicyFromPermissionSet",
                "sso:ListAccountAssignments",
                "sso:CreateAccountAssignment",
                "sso:DeleteAccountAssignment",
                "sso:DescribeAccountAssignmentCreationStatus",
                "sso:DescribeAccountAssignmentDeletionStatus"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "identitystore:ListGroups",
                "identitystore:DescribeGroup",
                "identitystore:ListGroupMemberships",
                "identitystore:DescribeGroupMembership"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "organizations:ListAccounts",
                "organizations:DescribeAccount"
            ],
            "Resource": "*"
        }
    ]
}
```

## Step 5: Validation

After configuring your `.env` file, validate the setup:

```bash
# Test configuration
npm run build
node dist/cli.js config --validate

# Test Azure AD connection
node dist/cli.js discover-groups

# Test AWS connection
node dist/cli.js list-permission-sets

# Test system health
node dist/cli.js health
```

## Step 6: Security Best Practices

1. **Protect your `.env` file**:
   ```bash
   # Add to .gitignore (already done)
   echo ".env" >> .gitignore
   ```

2. **Use dotenvx encryption** (optional but recommended):
   ```bash
   # Encrypt your .env file for secure storage
   npm run env:encrypt

   # This creates .env.keys for decryption
   # Store .env.keys separately and securely
   ```

3. **Use least privilege**: Only grant necessary permissions

4. **Rotate secrets regularly**: Update client secrets and access keys periodically

5. **Monitor usage**: Review Azure AD and AWS CloudTrail logs

6. **Environment file management**:
   ```bash
   # Copy example file to start
   cp .env.example .env

   # Validate your configuration
   npm run env:validate
   ```

## Advanced: dotenvx Features

This project uses `dotenvx` instead of regular `dotenv` for enhanced security and features:

### Environment File Encryption
```bash
# Encrypt your .env file
npm run env:encrypt

# Decrypt when needed
npm run env:decrypt

# Generate/view encryption keypair
npm run env:keypair
```

### Multiple Environment Support
```bash
# Use different environment files
dotenvx run --env-file=.env.production -- node dist/cli.js config --validate
dotenvx run --env-file=.env.staging -- node dist/cli.js list-permission-sets
```

### Environment Validation
```bash
# Validate your environment setup
npm run env:validate
```

### Benefits of dotenvx:
- 🔐 **Encryption**: Encrypt sensitive environment files
- 🔄 **Multiple environments**: Easy switching between dev/staging/prod
- 🛡️ **Security**: Better secret management and compliance
- 📊 **Validation**: Built-in environment validation
- 🔍 **Debugging**: Better error messages and debugging tools

### Common Issues

1. **Azure AD Authentication Errors**:
   - Verify tenant ID is correct
   - Ensure client secret hasn't expired
   - Check API permissions are granted with admin consent

2. **AWS Permission Errors**:
   - Verify IAM permissions are correctly configured
   - Check if Identity Center instance ARN is correct
   - Ensure AWS credentials are properly configured

3. **Network Issues**:
   - Check firewall/proxy settings
   - Verify internet connectivity to Azure and AWS APIs

### Getting Help

If you encounter issues:
1. Check the logs: `tail -f aws-ag.log`
2. Run with debug logging: `LOG_LEVEL=debug`
3. Use dry-run mode to test: `--dry-run`

## Example Working Configuration

Here's an example of what your `.env` should look like (with fake values):

```bash
# Azure AD Configuration
AZURE_TENANT_ID=12345678-1234-1234-1234-123456789012
AZURE_CLIENT_ID=87654321-4321-4321-4321-210987654321
AZURE_CLIENT_SECRET=abcdef123456789~abcdef123456789
AZURE_ENTERPRISE_APP_ID=11111111-2222-3333-4444-555555555555

# AWS Configuration
AWS_REGION=us-east-1
AWS_IDENTITY_CENTER_INSTANCE_ARN=arn:aws:sso:::instance/ssoins-1234567890abcdef
AWS_IDENTITY_STORE_ID=d-1234567890

# Account Mapping
AWS_ACCOUNT_DEV=111111111111
AWS_ACCOUNT_QA=222222222222
AWS_ACCOUNT_STAGING=333333333333
AWS_ACCOUNT_PROD=444444444444
```

## Next Steps

Once configured, you can:
1. **Discover groups**: `aws-ag discover-groups`
2. **Create access grants**: `aws-ag create-access --help`
3. **Validate assignments**: `aws-ag validate-assignments`
4. **Generate reports**: `aws-ag reports --all`

Happy configuring! 🚀
