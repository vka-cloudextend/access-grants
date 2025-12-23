# AWS Access Grant Workflow Documentation

## Overview

This document describes the standardized workflow for setting up AWS access through Azure AD security groups and AWS IAM Identity Center integration.

## Manual Workflow (Current Process)

The current manual process follows these steps:

### 1. Create Azure Security Group
- **Format**: `CE-AWS-<Account>-<TicketId>`
- **Account**: One of `Dev`, `QA`, `Staging`, `Prod`
- **TicketId**: Format `AG-XXXX` (e.g., `AG-1234`)
- **Example**: `CE-AWS-Staging-AG-478`

### 2. Add Users to Security Group
- Add group owners (administrators)
- Add group members (users who need access)

### 3. Configure Enterprise Application Assignment
- Navigate to Enterprise application for AWS IAM Identity Center
- Under "Users & Groups", add assignment for the newly created group

### 4. Provision Group
- Use "Provision on demand" to sync the group to AWS
- Wait for provisioning to complete

### 5. Verify Group Synchronization
- Access AWS Master account (where AWS IAM Identity Center is configured)
- Verify that the Azure group has synced to AWS Identity Store

### 6. Create Permission Set
- In AWS IAM Identity Center, create a new Permission Set
- **Name**: Use the same name as the Azure Security Group (e.g., `CE-AWS-Staging-AG-478`)
- Configure appropriate policies and permissions

### 7. Configure Account Assignment
- Navigate to AWS Accounts section in IAM Identity Center
- Select the corresponding AWS Account (`Dev`, `QA`, `Staging`, or `Prod`)
- Assign the group to the permission set
- Wait for provisioning to complete

## Automated Workflow (Tool Implementation)

The AWS Access Grant tool automates this workflow with the following steps:

### Phase 1: Validation and Preparation
1. **Validate Input Parameters**
   - Verify account type (`Dev`, `QA`, `Staging`, `Prod`)
   - Validate ticket ID format (`AG-XXXX`)
   - Check user list for valid Azure AD users

2. **Generate Group Name**
   - Create standardized name: `CE-AWS-<Account>-<TicketId>`
   - Verify name doesn't already exist in Azure AD

### Phase 2: Azure AD Operations
3. **Create Security Group**
   - Create Azure AD security group with generated name
   - Set appropriate description and metadata

4. **Add Group Members**
   - Add specified owners to the group
   - Add specified members to the group
   - Validate all users exist in Azure AD

5. **Configure Enterprise Application**
   - Add group assignment to AWS IAM Identity Center enterprise application
   - Configure provisioning settings

### Phase 3: Synchronization and Verification
6. **Trigger Provisioning**
   - Initiate "provision on demand" for the group
   - Monitor provisioning status

7. **Verify AWS Synchronization**
   - Check AWS Identity Store for group presence
   - Validate group membership synchronization
   - Retry if synchronization is incomplete

### Phase 4: AWS Configuration
8. **Create Permission Set**
   - Create permission set with same name as Azure group
   - Apply appropriate policies based on account type and requirements
   - Use templates for common access patterns

9. **Configure Account Assignment**
   - Assign group to permission set in target AWS account
   - Monitor assignment provisioning status
   - Verify assignment is active

### Phase 5: Validation and Completion
10. **End-to-End Validation**
    - Test group member can authenticate through Azure AD
    - Verify AWS permissions are working correctly
    - Generate assignment summary report

## Naming Conventions

### Azure Security Group Names
- **Format**: `CE-AWS-<Account>-<TicketId>`
- **Account Types**: `Dev`, `QA`, `Staging`, `Prod`
- **Ticket Format**: `AG-` followed by 3-4 digits
- **Examples**:
  - `CE-AWS-Dev-AG-123`
  - `CE-AWS-QA-AG-456`
  - `CE-AWS-Staging-AG-789`
  - `CE-AWS-Prod-AG-1234`

### Permission Set Names
- **Format**: Same as Azure Security Group name
- **Examples**:
  - `CE-AWS-Dev-AG-123`
  - `CE-AWS-QA-AG-456`

### Tags and Metadata
- **CreatedBy**: `aws-ag-tool`
- **TicketId**: Original ticket ID (e.g., `AG-123`)
- **Account**: Target AWS account type
- **CreatedDate**: ISO timestamp of creation

## Account Mapping

| Account Type | AWS Account ID | Environment | Typical Use Case |
|--------------|----------------|-------------|------------------|
| Dev          | [Account-ID]   | Development | Development and testing |
| QA           | [Account-ID]   | Quality Assurance | QA testing and validation |
| Staging      | [Account-ID]   | Staging | Pre-production testing |
| Prod         | [Account-ID]   | Production | Production workloads |

## Error Handling and Rollback

### Common Failure Points
1. **Azure Group Creation**: Group name conflicts, permission issues
2. **User Addition**: Invalid users, permission denied
3. **Enterprise App Assignment**: Configuration errors
4. **Provisioning**: Sync failures, timeout issues
5. **AWS Permission Set**: Policy validation errors
6. **Account Assignment**: Provisioning failures

### Rollback Strategy
- **Phase 1-2 Failures**: Delete created Azure resources
- **Phase 3 Failures**: Remove enterprise app assignments, delete group
- **Phase 4-5 Failures**: Delete AWS resources, remove Azure assignments, delete group

## Compliance and Auditing

### Audit Trail
- All operations logged with timestamps and user context
- Group creation and modification events tracked
- Permission set assignments recorded
- Access validation results stored

### Compliance Requirements
- All groups follow naming convention
- Permission sets use approved policy templates
- Regular access reviews conducted
- Unused groups automatically flagged for cleanup

## Troubleshooting Guide

### Group Not Syncing to AWS
1. Check enterprise application provisioning status
2. Verify group is assigned to enterprise application
3. Trigger manual provisioning
4. Check Azure AD provisioning logs

### Permission Set Creation Fails
1. Validate policy ARNs and syntax
2. Check AWS IAM Identity Center limits
3. Verify account permissions
4. Review inline policy JSON format

### Assignment Provisioning Fails
1. Check AWS account status and permissions
2. Verify group exists in AWS Identity Store
3. Validate permission set configuration
4. Review AWS CloudTrail logs

### Users Cannot Access AWS
1. Verify user is member of Azure group
2. Check group synchronization status
3. Validate permission set policies
4. Test AWS console access directly

## Best Practices

### Group Management
- Use descriptive group names following convention
- Add appropriate owners and members initially
- Regular review of group membership
- Clean up unused groups promptly

### Permission Set Design
- Use least privilege principle
- Leverage managed policies when possible
- Document custom inline policies
- Regular review of permission sets

### Monitoring and Maintenance
- Monitor synchronization status regularly
- Set up alerts for provisioning failures
- Conduct periodic access reviews
- Maintain audit logs for compliance

## Tool Configuration

### Required Permissions

#### Azure AD Permissions
- `Group.ReadWrite.All` - Create and manage security groups
- `User.Read.All` - Read user information for validation
- `Application.ReadWrite.All` - Manage enterprise application assignments

#### AWS Permissions
- `sso:CreatePermissionSet` - Create permission sets
- `sso:AttachManagedPolicyToPermissionSet` - Attach policies
- `sso:CreateAccountAssignment` - Create assignments
- `identitystore:ListGroups` - Verify group synchronization
- `identitystore:DescribeGroup` - Get group details

### Environment Variables
```bash
# Azure Configuration
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret

# AWS Configuration
AWS_REGION=us-east-1
AWS_IDENTITY_CENTER_INSTANCE_ARN=arn:aws:sso:::instance/ssoins-xxxxxxxxx
AWS_IDENTITY_STORE_ID=d-xxxxxxxxxx

# Account Mapping
AWS_DEV_ACCOUNT_ID=123456789012
AWS_QA_ACCOUNT_ID=123456789013
AWS_STAGING_ACCOUNT_ID=123456789014
AWS_PROD_ACCOUNT_ID=123456789015
```

## CLI Usage Examples

### Create New Access Grant
```bash
aws-ag create-access \
  --account Dev \
  --ticket-id AG-123 \
  --owners user1@company.com,user2@company.com \
  --members user3@company.com,user4@company.com \
  --permission-template developer
```

### List Existing Access Grants
```bash
aws-ag list-access --account Dev
aws-ag list-access --all
```

### Validate Access Grant
```bash
aws-ag validate-access --group-name CE-AWS-Dev-AG-123
```

### Rollback Access Grant
```bash
aws-ag rollback --operation-id abc-123-def
```
