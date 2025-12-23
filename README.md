# AWS Access Grants (aws-ag)

AWS Access Grants is a CLI tool for managing Azure AD security groups within an existing AWS IAM Identity Center integration. The tool automates the standardized workflow for creating access grants that follow organizational naming conventions and best practices.

## Overview

This tool automates the manual process of setting up AWS access through Azure AD security groups, following the standardized workflow:

1. **Create Azure Security Group** with standardized naming (`CE-AWS-<Account>-<TicketId>`)
2. **Add Users** (owners and members) to the security group
3. **Configure Enterprise Application** assignment for AWS IAM Identity Center
4. **Trigger Provisioning** to sync the group to AWS
5. **Verify Synchronization** in AWS Identity Store
6. **Create Permission Set** with the same name as the Azure group
7. **Configure Account Assignment** to assign the group to the permission set and AWS account

## Features

- **Standardized Workflow**: Follows the documented manual process exactly
- **Naming Convention Enforcement**: Ensures all groups follow `CE-AWS-<Account>-<TicketId>` format
- **Permission Set Templates**: Pre-built templates for common access patterns
- **Comprehensive Validation**: End-to-end validation of the entire setup
- **Rollback Capabilities**: Automatic rollback on failures
- **Audit Trail**: Complete logging of all operations
- **Conflict Detection**: Prevents duplicate assignments and naming conflicts

## Prerequisites

- Node.js 18.0.0 or higher
- Existing AWS IAM Identity Center integration with Azure AD
- Azure AD application with appropriate permissions
- AWS credentials with SSO Admin permissions

## Installation

```bash
npm install
npm run build
```

## Configuration

Set up your environment variables or create a `.env` file:

```env
# Azure Configuration
AZURE_TENANT_ID=your-tenant-id
AZURE_CLIENT_ID=your-client-id
AZURE_CLIENT_SECRET=your-client-secret
AZURE_ENTERPRISE_APP_ID=aws-iam-identity-center-app-id

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

## Usage

### Create Access Grant

Create a new access grant following the standardized workflow:

```bash
# Basic usage with template
aws-ag create-access \
  --account Dev \
  --ticket-id AG-123 \
  --owners admin1@company.com,admin2@company.com \
  --members dev1@company.com,dev2@company.com \
  --template developer

# Custom permissions
aws-ag create-access \
  --account Staging \
  --ticket-id AG-456 \
  --owners manager@company.com \
  --members tester1@company.com,tester2@company.com \
  --managed-policies arn:aws:iam::aws:policy/ReadOnlyAccess \
  --session-duration PT4H
```

This will create:
- Azure Security Group: `CE-AWS-Dev-AG-123`
- AWS Permission Set: `CE-AWS-Dev-AG-123`
- Account assignment in the specified AWS account

### List Access Grants

```bash
# List all access grants
aws-ag list-access

# List by environment
aws-ag list-access --account Dev
aws-ag list-access --account Prod
```

### Validate Access Grant

```bash
# Validate a specific access grant
aws-ag validate-access --group-name CE-AWS-Dev-AG-123

# Validate all access grants
aws-ag validate-access --all
```

### Permission Set Templates

```bash
# List available templates
aws-ag list-templates

# Get template details
aws-ag describe-template --name developer
```

### Rollback Operations

```bash
# Rollback a failed or completed operation
aws-ag rollback --operation-id abc-123-def
```

## Permission Set Templates

The tool includes pre-built templates for common access patterns:

| Template | Description | Use Case |
|----------|-------------|----------|
| `readonly` | Read-only access to AWS resources | Auditors, viewers |
| `developer` | Developer access with PowerUser permissions | Application developers |
| `admin` | Full administrative access | System administrators |
| `s3-access` | S3 bucket and object access | Data teams |
| `ec2-access` | EC2 and related services access | Infrastructure teams |
| `lambda-developer` | Lambda development and deployment | Serverless developers |
| `database-admin` | RDS and DynamoDB access | Database administrators |
| `security-auditor` | Security auditing permissions | Security teams |
| `billing-access` | Billing and cost management | Finance teams |

## Naming Convention

All access grants follow the standardized naming convention:

- **Format**: `CE-AWS-<Account>-<TicketId>`
- **Account**: One of `Dev`, `QA`, `Staging`, `Prod`
- **TicketId**: Format `AG-XXX` or `AG-XXXX` (e.g., `AG-123`, `AG-1234`)

**Examples**:
- `CE-AWS-Dev-AG-123`
- `CE-AWS-Staging-AG-456`
- `CE-AWS-Prod-AG-1234`

## API Usage

You can also use the tool programmatically:

```typescript
import { AssignmentOrchestrator, AccessGrantRequest } from 'aws-ag';

const orchestrator = new AssignmentOrchestrator(config);

const request: AccessGrantRequest = {
    accountType: 'Dev',
    ticketId: 'AG-123',
    owners: ['admin@company.com'],
    members: ['dev1@company.com', 'dev2@company.com'],
    permissionTemplate: 'developer'
};

const result = await orchestrator.createAccessGrant(request);
console.log(`Created: ${result.groupName}`);
```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix
```

## Project Structure

```
src/
├── cli.ts              # CLI interface and commands
├── types/              # TypeScript type definitions
├── clients/            # Azure AD and AWS API clients
├── orchestrator/       # Assignment orchestration logic
├── permission-sets/    # Permission set management and templates
├── validator/          # Assignment validation
├── reporter/           # Configuration reporting
└── test/               # Test utilities and setup

docs/
└── WORKFLOW.md         # Detailed workflow documentation

examples/
└── access-grant-example.ts  # Usage examples
```

## Documentation

- [Workflow Documentation](docs/WORKFLOW.md) - Detailed workflow and troubleshooting guide
- [Examples](examples/) - Code examples and usage patterns

## License

MIT
