// Example: Creating an access grant using the standardized workflow
import { AssignmentOrchestrator, OrchestrationConfig, AccessGrantRequest } from '../src/orchestrator';

// Example configuration
const config: OrchestrationConfig = {
    azure: {
        tenantId: 'your-tenant-id',
        clientId: 'your-client-id',
        clientSecret: 'your-client-secret',
        enterpriseApplicationId: 'aws-iam-identity-center-app-id'
    },
    aws: {
        region: 'us-east-1',
        identityCenterInstanceArn: 'arn:aws:sso:::instance/ssoins-xxxxxxxxx',
        identityStoreId: 'd-xxxxxxxxxx',
        accountMapping: {
            Dev: '123456789012',
            QA: '123456789013',
            Staging: '123456789014',
            Prod: '123456789015'
        }
    },
    retryAttempts: 3,
    retryDelayMs: 5000
};

async function createAccessGrantExample() {
    const orchestrator = new AssignmentOrchestrator( config );

    // Example 1: Create access grant for development environment
    const devAccessRequest: AccessGrantRequest = {
        accountType: 'Dev',
        ticketId: 'AG-123',
        owners: [ 'admin1@company.com', 'admin2@company.com' ],
        members: [ 'developer1@company.com', 'developer2@company.com', 'developer3@company.com' ],
        permissionTemplate: 'developer', // Use the developer template
        description: 'Development access for Project Alpha team'
    };

    try {
        console.log( 'Creating access grant for Dev environment...' );
        const result = await orchestrator.createAccessGrant( devAccessRequest );

        console.log( 'Access grant created successfully!' );
        console.log( `Group Name: ${result.groupName}` );
        console.log( `Azure Group ID: ${result.azureGroupId}` );
        console.log( `Permission Set ARN: ${result.permissionSetArn}` );
        console.log( `AWS Account ID: ${result.awsAccountId}` );
        console.log( `Operation ID: ${result.operation.operationId}` );

        if ( result.validationResults ) {
            console.log( 'Validation Results:' );
            console.log( `- Group Synced: ${result.validationResults.groupSynced}` );
            console.log( `- Permission Set Created: ${result.validationResults.permissionSetCreated}` );
            console.log( `- Assignment Active: ${result.validationResults.assignmentActive}` );
            console.log( `- Users Can Access: ${result.validationResults.usersCanAccess}` );
        }

    } catch ( error ) {
        console.error( 'Failed to create access grant:', error );
    }

    // Example 2: Create access grant with custom permissions
    const customAccessRequest: AccessGrantRequest = {
        accountType: 'Staging',
        ticketId: 'AG-456',
        owners: [ 'manager@company.com' ],
        members: [ 'tester1@company.com', 'tester2@company.com' ],
        customPermissions: {
            managedPolicies: [
                'arn:aws:iam::aws:policy/ReadOnlyAccess',
                'arn:aws:iam::aws:policy/AmazonS3FullAccess'
            ],
            sessionDuration: 'PT4H'
        },
        description: 'Custom staging access for QA team'
    };

    try {
        console.log( 'Creating custom access grant for Staging environment...' );
        const result = await orchestrator.createAccessGrant( customAccessRequest );
        console.log( 'Custom access grant created successfully!' );
        console.log( `Group Name: ${result.groupName}` ); // Will be: CE-AWS-Staging-AG-456

    } catch ( error ) {
        console.error( 'Failed to create custom access grant:', error );
    }
}

async function listAndValidateExample() {
    const orchestrator = new AssignmentOrchestrator( config );

    // List all access grants for Dev environment
    try {
        console.log( 'Listing Dev environment access grants...' );
        const devGrants = await orchestrator.listAccessGrants( 'Dev' );

        for ( const grant of devGrants ) {
            console.log( `- ${grant.groupName} (${grant.operation.status})` );
        }

    } catch ( error ) {
        console.error( 'Failed to list access grants:', error );
    }

    // Validate a specific access grant
    try {
        console.log( 'Validating access grant CE-AWS-Dev-AG-123...' );
        const validation = await orchestrator.validateAccessGrant( 'CE-AWS-Dev-AG-123' );

        console.log( 'Validation Results:' );
        console.log( `- Account Type: ${validation.accountType}` );
        console.log( `- Ticket ID: ${validation.ticketId}` );
        console.log( `- Azure Group Valid: ${validation.azureGroup.isValid}` );
        console.log( `- Synchronized: ${validation.synchronization.isSynced}` );
        console.log( `- Permission Set Exists: ${validation.permissionSet.exists}` );
        console.log( `- Assignment Exists: ${validation.assignment.exists}` );

    } catch ( error ) {
        console.error( 'Failed to validate access grant:', error );
    }
}

async function permissionSetTemplatesExample() {
    const orchestrator = new AssignmentOrchestrator( config );

    // Get available templates
    console.log( 'Available Permission Set Templates:' );
    const templates = orchestrator.getPermissionSetTemplates();

    for ( const template of templates ) {
        console.log( `- ${template.name}: ${template.description}` );
        console.log( `  Session Duration: ${template.sessionDuration}` );
        console.log( `  Managed Policies: ${template.managedPolicies.length}` );
        console.log( '' );
    }

    // Get recommendations for a group
    const recommendations = orchestrator.getPermissionSetRecommendations(
        'CE-AWS-Dev-AG-789',
        'Developer access for backend services'
    );

    console.log( 'Recommended templates for developer group:' );
    for ( const rec of recommendations ) {
        console.log( `- ${rec}` );
    }
}

// Run examples
async function main() {
    console.log( '=== AWS Access Grant Workflow Examples ===\n' );

    console.log( '1. Permission Set Templates:' );
    await permissionSetTemplatesExample();

    console.log( '\n2. Creating Access Grants:' );
    await createAccessGrantExample();

    console.log( '\n3. Listing and Validating:' );
    await listAndValidateExample();
}

// Uncomment to run examples
// main().catch(console.error);

export {
    createAccessGrantExample,
    listAndValidateExample,
    permissionSetTemplatesExample
};
