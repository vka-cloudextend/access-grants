#!/usr/bin/env node

import { Command } from 'commander';
import { config } from 'dotenv';
import { AzureClient } from './clients/azure-client';
import { AWSClient } from './clients/aws-client';
import { AssignmentOrchestrator, OrchestrationConfig, AccessGrantRequest } from './orchestrator';

// Load environment variables
config();

const program = new Command();

program
    .name( 'aws-ag' )
    .description( 'AWS Access Grants - CLI tool for managing Azure AD security groups within AWS IAM Identity Center integration' )
    .version( '1.0.0' );

// Configuration helper
function getConfig(): OrchestrationConfig {
    const requiredEnvVars = [
        'AZURE_TENANT_ID',
        'AZURE_CLIENT_ID',
        'AZURE_CLIENT_SECRET',
        'AZURE_ENTERPRISE_APP_ID',
        'AWS_REGION',
        'AWS_IDENTITY_CENTER_INSTANCE_ARN',
        'AWS_IDENTITY_STORE_ID',
        'AWS_ACCOUNT_DEV',
        'AWS_ACCOUNT_QA',
        'AWS_ACCOUNT_STAGING',
        'AWS_ACCOUNT_PROD'
    ];

    for ( const envVar of requiredEnvVars ) {
        if ( !process.env[ envVar ] ) {
            console.error( `Error: Missing required environment variable: ${envVar}` );
            process.exit( 1 );
        }
    }

    return {
        azure: {
            tenantId: process.env.AZURE_TENANT_ID!,
            clientId: process.env.AZURE_CLIENT_ID!,
            clientSecret: process.env.AZURE_CLIENT_SECRET!,
            enterpriseApplicationId: process.env.AZURE_ENTERPRISE_APP_ID!
        },
        aws: {
            region: process.env.AWS_REGION!,
            identityCenterInstanceArn: process.env.AWS_IDENTITY_CENTER_INSTANCE_ARN!,
            identityStoreId: process.env.AWS_IDENTITY_STORE_ID!,
            accountMapping: {
                Dev: process.env.AWS_ACCOUNT_DEV!,
                QA: process.env.AWS_ACCOUNT_QA!,
                Staging: process.env.AWS_ACCOUNT_STAGING!,
                Prod: process.env.AWS_ACCOUNT_PROD!
            }
        }
    };
}

// Helper to create orchestrator instance
function createOrchestrator(): AssignmentOrchestrator {
    const config = getConfig();
    return new AssignmentOrchestrator( config );
}

// Helper to create Azure client
function createAzureClient(): AzureClient {
    const config = getConfig();
    return new AzureClient( config.azure );
}

// Helper to create AWS client
function createAWSClient(): AWSClient {
    const config = getConfig();
    return new AWSClient( config.aws );
}

// discover-groups command - List and filter Azure AD groups
program
    .command( 'discover-groups' )
    .description( 'List and filter Azure AD groups' )
    .option( '-f, --filter <filter>', 'Filter groups by name or description' )
    .option( '--show-assigned', 'Show groups already assigned to AWS' )
    .option( '--show-unassigned', 'Show only groups not assigned to AWS' )
    .option( '--format <format>', 'Output format (table|json)', 'table' )
    .action( async ( options ) => {
        try {
            const azureClient = createAzureClient();
            const groups = await azureClient.listSecurityGroups( options.filter );

            // Filter based on assignment status
            let filteredGroups = groups;
            if ( options.showAssigned && !options.showUnassigned ) {
                filteredGroups = groups.filter( g => g.isAssignedToAWS );
            } else if ( options.showUnassigned && !options.showAssigned ) {
                filteredGroups = groups.filter( g => !g.isAssignedToAWS );
            }

            if ( options.format === 'json' ) {
                console.log( JSON.stringify( filteredGroups, null, 2 ) );
            } else {
                // Table format
                console.log( '\nAzure AD Security Groups:' );
                console.log( '========================' );

                if ( filteredGroups.length === 0 ) {
                    console.log( 'No groups found matching the criteria.' );
                    return;
                }

                filteredGroups.forEach( group => {
                    console.log( `\nName: ${group.displayName}` );
                    console.log( `ID: ${group.id}` );
                    console.log( `Description: ${group.description || 'N/A'}` );
                    console.log( `Members: ${group.memberCount}` );
                    console.log( `AWS Assigned: ${group.isAssignedToAWS ? 'Yes' : 'No'}` );
                    console.log( '---' );
                } );

                console.log( `\nTotal: ${filteredGroups.length} groups` );
            }
        } catch ( error ) {
            console.error( 'Error discovering groups:', error instanceof Error ? error.message : 'Unknown error' );
            process.exit( 1 );
        }
    } );

// list-permission-sets command - Show available AWS permission sets
program
    .command( 'list-permission-sets' )
    .description( 'Show available AWS permission sets' )
    .option( '--show-assignments', 'Show account assignments for each permission set' )
    .option( '--format <format>', 'Output format (table|json)', 'table' )
    .action( async ( options ) => {
        try {
            const awsClient = createAWSClient();
            const permissionSets = await awsClient.listPermissionSets();

            if ( options.format === 'json' ) {
                console.log( JSON.stringify( permissionSets, null, 2 ) );
            } else {
                // Table format
                console.log( '\nAWS Permission Sets:' );
                console.log( '===================' );

                if ( permissionSets.length === 0 ) {
                    console.log( 'No permission sets found.' );
                    return;
                }

                for ( const ps of permissionSets ) {
                    console.log( `\nName: ${ps.name}` );
                    console.log( `ARN: ${ps.arn}` );
                    console.log( `Description: ${ps.description || 'N/A'}` );
                    console.log( `Session Duration: ${ps.sessionDuration}` );

                    if ( options.showAssignments ) {
                        const allAssignments = await awsClient.listAccountAssignments();
                        const assignments = allAssignments.filter( a => a.permissionSetArn === ps.arn );
                        console.log( `Assignments: ${assignments.length}` );
                        if ( assignments.length > 0 ) {
                            assignments.forEach( assignment => {
                                console.log( `  - Account: ${assignment.accountId}, Principal: ${assignment.principalId} (${assignment.principalType})` );
                            } );
                        }
                    }
                    console.log( '---' );
                }

                console.log( `\nTotal: ${permissionSets.length} permission sets` );
            }
        } catch ( error ) {
            console.error( 'Error listing permission sets:', error instanceof Error ? error.message : 'Unknown error' );
            process.exit( 1 );
        }
    } );

// assign-group command - Assign a group to permission set and accounts
program
    .command( 'assign-group' )
    .description( 'Assign a group to permission set and accounts' )
    .requiredOption( '-g, --group-id <groupId>', 'Azure AD group ID' )
    .requiredOption( '-p, --permission-set <permissionSetArn>', 'AWS permission set ARN' )
    .requiredOption( '-a, --account <accountId>', 'AWS account ID' )
    .option( '--dry-run', 'Show what would be done without making changes' )
    .action( async ( options ) => {
        try {
            const orchestrator = createOrchestrator();

            if ( options.dryRun ) {
                console.log( 'DRY RUN - No changes will be made' );
                console.log( `Would assign group ${options.groupId} to permission set ${options.permissionSet} in account ${options.account}` );

                // Validate inputs
                const azureClient = createAzureClient();
                const validation = await azureClient.validateGroupDetailed( options.groupId );
                console.log( `\nGroup validation: ${validation.isValid ? 'PASS' : 'FAIL'}` );
                if ( !validation.isValid ) {
                    console.log( `Validation errors: ${validation.errors.join( ', ' )}` );
                }
                return;
            }

            console.log( 'Creating group assignment...' );
            const operation = await orchestrator.createAssignment( {
                azureGroupId: options.groupId,
                azureGroupName: '', // Will be populated by orchestrator
                awsAccountId: options.account,
                permissionSetArn: options.permissionSet
            } );

            console.log( `\nOperation ${operation.operationId} ${operation.status}` );
            if ( operation.status === 'COMPLETED' ) {
                console.log( 'Group assignment created successfully!' );
            } else {
                console.log( 'Assignment failed:' );
                operation.errors.forEach( error => {
                    console.log( `  - ${error.message}` );
                } );
                process.exit( 1 );
            }
        } catch ( error ) {
            console.error( 'Error assigning group:', error instanceof Error ? error.message : 'Unknown error' );
            process.exit( 1 );
        }
    } );

// bulk-assign command - Assign multiple groups at once
program
    .command( 'bulk-assign' )
    .description( 'Assign multiple groups at once' )
    .requiredOption( '-f, --file <file>', 'JSON file containing assignment definitions' )
    .option( '--dry-run', 'Show what would be done without making changes' )
    .action( async ( options ) => {
        try {
            const fs = await import( 'fs/promises' );
            const assignmentData = JSON.parse( await fs.readFile( options.file, 'utf-8' ) );

            if ( !Array.isArray( assignmentData ) ) {
                throw new Error( 'Assignment file must contain an array of assignments' );
            }

            const orchestrator = createOrchestrator();

            if ( options.dryRun ) {
                console.log( 'DRY RUN - No changes will be made' );
                console.log( `Would process ${assignmentData.length} assignments:` );

                assignmentData.forEach( ( assignment, index ) => {
                    console.log( `  ${index + 1}. Group ${assignment.azureGroupId} -> Permission Set ${assignment.permissionSetArn} in Account ${assignment.awsAccountId}` );
                } );
                return;
            }

            console.log( `Processing ${assignmentData.length} bulk assignments...` );
            const operation = await orchestrator.bulkAssign( assignmentData );

            console.log( `\nOperation ${operation.operationId} ${operation.status}` );

            const successCount = operation.assignments.filter( a => a.assignmentStatus === 'ACTIVE' ).length;
            const failureCount = operation.assignments.filter( a => a.assignmentStatus === 'FAILED' ).length;

            console.log( `Results: ${successCount} successful, ${failureCount} failed` );

            if ( operation.errors.length > 0 ) {
                console.log( '\nErrors:' );
                operation.errors.forEach( error => {
                    console.log( `  - ${error.message}` );
                } );
            }

            if ( failureCount > 0 ) {
                process.exit( 1 );
            }
        } catch ( error ) {
            console.error( 'Error in bulk assignment:', error instanceof Error ? error.message : 'Unknown error' );
            process.exit( 1 );
        }
    } );

// list-assignments command - Show current group assignments
program
    .command( 'list-assignments' )
    .description( 'Show current group assignments' )
    .option( '-a, --account <accountId>', 'Filter by AWS account ID' )
    .option( '--format <format>', 'Output format (table|json)', 'table' )
    .action( async ( options ) => {
        try {
            const awsClient = createAWSClient();
            let assignments;

            if ( options.account ) {
                assignments = await awsClient.getAccountAssignmentsForAccount( options.account );
            } else {
                assignments = await awsClient.listAccountAssignments();
            }

            if ( options.format === 'json' ) {
                console.log( JSON.stringify( assignments, null, 2 ) );
            } else {
                // Table format
                console.log( '\nCurrent Group Assignments:' );
                console.log( '=========================' );

                if ( assignments.length === 0 ) {
                    console.log( 'No assignments found.' );
                    return;
                }

                assignments.forEach( assignment => {
                    console.log( `\nAccount: ${assignment.accountId}` );
                    console.log( `Principal: ${assignment.principalId} (${assignment.principalType})` );
                    console.log( `Permission Set: ${assignment.permissionSetArn}` );
                    console.log( `Status: ${assignment.status}` );
                    console.log( '---' );
                } );

                console.log( `\nTotal: ${assignments.length} assignments` );
            }
        } catch ( error ) {
            console.error( 'Error listing assignments:', error instanceof Error ? error.message : 'Unknown error' );
            process.exit( 1 );
        }
    } );

// validate-assignments command - Test assignment functionality
program
    .command( 'validate-assignments' )
    .description( 'Test assignment functionality' )
    .option( '-g, --group-id <groupId>', 'Validate specific group assignment' )
    .option( '-a, --account <accountId>', 'Validate assignments for specific account' )
    .action( async ( options ) => {
        try {
            const awsClient = createAWSClient();
            const azureClient = createAzureClient();

            if ( options.groupId ) {
                // Validate specific group
                console.log( `Validating group ${options.groupId}...` );

                const validation = await azureClient.validateGroupDetailed( options.groupId );
                console.log( `\nAzure Group Validation: ${validation.isValid ? 'PASS' : 'FAIL'}` );
                if ( !validation.isValid ) {
                    console.log( `Errors: ${validation.errors.join( ', ' )}` );
                }

                const syncStatus = await awsClient.checkGroupSynchronizationStatus( options.groupId );
                console.log( `AWS Synchronization: ${syncStatus.isSynced ? 'SYNCED' : 'NOT SYNCED'}` );
                if ( syncStatus.awsGroupId ) {
                    console.log( `AWS Group ID: ${syncStatus.awsGroupId}` );
                }

                // Check assignments
                const assignments = await awsClient.listAccountAssignments();
                const groupAssignments = assignments.filter( a => a.principalId === options.groupId );
                console.log( `Active Assignments: ${groupAssignments.length}` );

                groupAssignments.forEach( assignment => {
                    console.log( `  - Account: ${assignment.accountId}, Permission Set: ${assignment.permissionSetArn}` );
                } );

            } else if ( options.account ) {
                // Validate assignments for specific account
                console.log( `Validating assignments for account ${options.account}...` );

                const assignments = await awsClient.getAccountAssignmentsForAccount( options.account );
                console.log( `\nFound ${assignments.length} assignments` );

                for ( const assignment of assignments ) {
                    console.log( `\nValidating assignment: ${assignment.principalId}` );

                    if ( assignment.principalType === 'GROUP' ) {
                        const syncStatus = await awsClient.checkGroupSynchronizationStatus( assignment.principalId );
                        console.log( `  Sync Status: ${syncStatus.isSynced ? 'SYNCED' : 'NOT SYNCED'}` );
                    }

                    console.log( `  Status: ${assignment.status}` );
                }

            } else {
                // General validation
                console.log( 'Performing general assignment validation...' );

                const assignments = await awsClient.listAccountAssignments();
                console.log( `\nTotal assignments: ${assignments.length}` );

                const groupAssignments = assignments.filter( a => a.principalType === 'GROUP' );
                console.log( `Group assignments: ${groupAssignments.length}` );

                let syncedGroups = 0;
                for ( const assignment of groupAssignments ) {
                    const syncStatus = await awsClient.checkGroupSynchronizationStatus( assignment.principalId );
                    if ( syncStatus.isSynced ) {
                        syncedGroups++;
                    }
                }

                console.log( `Synced groups: ${syncedGroups}/${groupAssignments.length}` );

                if ( syncedGroups < groupAssignments.length ) {
                    console.log( '\nWarning: Some groups are not properly synchronized' );
                }
            }
        } catch ( error ) {
            console.error( 'Error validating assignments:', error instanceof Error ? error.message : 'Unknown error' );
            process.exit( 1 );
        }
    } );

// export-config command - Export current configuration
program
    .command( 'export-config' )
    .description( 'Export current configuration' )
    .option( '-o, --output <file>', 'Output file (default: stdout)' )
    .option( '--include-assignments', 'Include current assignments in export' )
    .action( async ( options ) => {
        try {
            const config = getConfig();
            const awsClient = createAWSClient();

            const exportData: any = {
                timestamp: new Date().toISOString(),
                configuration: {
                    azure: {
                        tenantId: config.azure.tenantId,
                        enterpriseApplicationId: config.azure.enterpriseApplicationId
                        // Note: Not exporting sensitive credentials
                    },
                    aws: {
                        region: config.aws.region,
                        identityCenterInstanceArn: config.aws.identityCenterInstanceArn,
                        identityStoreId: config.aws.identityStoreId,
                        accountMapping: config.aws.accountMapping
                    }
                }
            };

            if ( options.includeAssignments ) {
                const assignments = await awsClient.listAccountAssignments();
                const permissionSets = await awsClient.listPermissionSets();

                exportData.assignments = assignments;
                exportData.permissionSets = permissionSets;
            }

            const output = JSON.stringify( exportData, null, 2 );

            if ( options.output ) {
                const fs = await import( 'fs/promises' );
                await fs.writeFile( options.output, output );
                console.log( `Configuration exported to ${options.output}` );
            } else {
                console.log( output );
            }
        } catch ( error ) {
            console.error( 'Error exporting configuration:', error instanceof Error ? error.message : 'Unknown error' );
            process.exit( 1 );
        }
    } );

// rollback command - Undo recent assignments
program
    .command( 'rollback' )
    .description( 'Undo recent assignments' )
    .requiredOption( '-o, --operation-id <operationId>', 'Operation ID to rollback' )
    .option( '--confirm', 'Confirm rollback without prompting' )
    .action( async ( options ) => {
        try {
            const orchestrator = createOrchestrator();

            const operation = orchestrator.getOperationStatus( options.operationId );
            if ( !operation ) {
                console.error( `Operation ${options.operationId} not found` );
                process.exit( 1 );
            }

            if ( operation.status !== 'COMPLETED' ) {
                console.error( `Cannot rollback operation ${options.operationId} - status is ${operation.status}` );
                process.exit( 1 );
            }

            console.log( `Operation ${options.operationId}:` );
            console.log( `  Type: ${operation.operationType}` );
            console.log( `  Assignments: ${operation.assignments.length}` );
            console.log( `  Started: ${operation.startTime.toISOString()}` );

            if ( !options.confirm ) {
                const readline = await import( 'readline' );
                const rl = readline.createInterface( {
                    input: process.stdin,
                    output: process.stdout
                } );

                const answer = await new Promise<string>( ( resolve ) => {
                    rl.question( 'Are you sure you want to rollback this operation? (yes/no): ', resolve );
                } );

                rl.close();

                if ( answer.toLowerCase() !== 'yes' ) {
                    console.log( 'Rollback cancelled' );
                    return;
                }
            }

            console.log( 'Performing rollback...' );
            await orchestrator.rollbackOperation( options.operationId );
            console.log( 'Rollback completed successfully' );

        } catch ( error ) {
            console.error( 'Error performing rollback:', error instanceof Error ? error.message : 'Unknown error' );
            process.exit( 1 );
        }
    } );

// validate-access command - Validate access grant status
program
    .command( 'validate-access' )
    .description( 'Validate access grant and provide detailed status report' )
    .requiredOption( '-g, --group-name <groupName>', 'Group name to validate (CE-AWS-<Account>-<TicketId> format)' )
    .option( '--fix-issues', 'Attempt to fix detected issues automatically' )
    .option( '--format <format>', 'Output format (table|json)', 'table' )
    .action( async ( options ) => {
        try {
            const groupName = options.groupName;

            // Validate group name format
            const nameParts = groupName.split( '-' );
            if ( nameParts.length !== 4 || nameParts[ 0 ] !== 'CE' || nameParts[ 1 ] !== 'AWS' ) {
                console.error( `Error: Group name must follow format CE-AWS-<Account>-<TicketId>` );
                console.error( `Provided: ${groupName}` );
                process.exit( 1 );
            }

            const accountType = nameParts[ 2 ];
            const ticketId = nameParts[ 3 ];

            if ( ![ 'Dev', 'QA', 'Staging', 'Prod' ].includes( accountType ) ) {
                console.error( `Error: Invalid account type '${accountType}'. Must be one of: Dev, QA, Staging, Prod` );
                process.exit( 1 );
            }

            if ( !/^AG-\d{3,4}$/.test( ticketId ) ) {
                console.error( `Error: Invalid ticket ID '${ticketId}'. Must be in format AG-XXX or AG-XXXX` );
                process.exit( 1 );
            }

            console.log( `Validating access grant: ${groupName}` );
            console.log( '=======================================' );

            const orchestrator = createOrchestrator();
            const validation = await orchestrator.validateAccessGrant( groupName );

            if ( options.format === 'json' ) {
                console.log( JSON.stringify( validation, null, 2 ) );
                return;
            }

            // Table format
            console.log( `\nAccess Grant: ${validation.groupName}` );
            console.log( `Account Type: ${validation.accountType}` );
            console.log( `Ticket ID: ${validation.ticketId}` );

            console.log( '\n🔍 Validation Results:' );
            console.log( '=====================' );

            // Azure Group Status
            console.log( '\n📁 Azure AD Group:' );
            console.log( `  Exists: ${validation.azureGroup.exists ? '✅' : '❌'}` );
            console.log( `  Valid: ${validation.azureGroup.isValid ? '✅' : '❌'}` );
            console.log( `  Members: ${validation.azureGroup.memberCount}` );

            if ( validation.azureGroup.errors.length > 0 ) {
                console.log( '  Issues:' );
                validation.azureGroup.errors.forEach( ( error: string ) => {
                    console.log( `    ❌ ${error}` );
                } );
            }

            // Synchronization Status
            console.log( '\n🔄 Azure-AWS Synchronization:' );
            console.log( `  Synced: ${validation.synchronization.isSynced ? '✅' : '❌'}` );
            if ( validation.synchronization.awsGroupId ) {
                console.log( `  AWS Group ID: ${validation.synchronization.awsGroupId}` );
            }
            if ( validation.synchronization.lastSyncTime ) {
                console.log( `  Last Sync: ${validation.synchronization.lastSyncTime.toISOString()}` );
            }

            // Permission Set Status
            console.log( '\n🔐 AWS Permission Set:' );
            console.log( `  Exists: ${validation.permissionSet.exists ? '✅' : '❌'}` );
            if ( validation.permissionSet.name ) {
                console.log( `  Name: ${validation.permissionSet.name}` );
            }
            if ( validation.permissionSet.arn ) {
                console.log( `  ARN: ${validation.permissionSet.arn}` );
            }

            // Assignment Status
            console.log( '\n🎯 Account Assignment:' );
            console.log( `  Exists: ${validation.assignment.exists ? '✅' : '❌'}` );
            console.log( `  Status: ${validation.assignment.status || 'N/A'}` );
            if ( validation.assignment.accountId ) {
                console.log( `  Account: ${validation.assignment.accountId}` );
            }

            // Overall Status
            const allValid = validation.azureGroup.isValid &&
                validation.synchronization.isSynced &&
                validation.permissionSet.exists &&
                validation.assignment.exists;

            console.log( '\n📊 Overall Status:' );
            if ( allValid ) {
                console.log( '✅ Access grant is fully functional' );
            } else {
                console.log( '❌ Access grant has issues that need attention' );
            }

            // Issues and Recommendations
            const issues: string[] = [];
            const recommendations: string[] = [];

            if ( !validation.azureGroup.exists ) {
                issues.push( 'Azure AD group does not exist' );
                recommendations.push( `Create the Azure AD group '${groupName}' manually or re-run create-access command` );
            } else if ( !validation.azureGroup.isValid ) {
                issues.push( 'Azure AD group has validation issues' );
                recommendations.push( 'Check group membership and ensure it has active members' );
            }

            if ( !validation.synchronization.isSynced ) {
                issues.push( 'Group is not synchronized to AWS' );
                recommendations.push( 'Check Azure AD provisioning configuration and trigger manual sync if needed' );
            }

            if ( !validation.permissionSet.exists ) {
                issues.push( 'AWS permission set does not exist' );
                recommendations.push( `Create permission set '${groupName}' in AWS IAM Identity Center` );
            }

            if ( !validation.assignment.exists ) {
                issues.push( 'Account assignment does not exist' );
                recommendations.push( 'Create account assignment between the group and permission set' );
            } else if ( validation.assignment.status !== 'PROVISIONED' ) {
                issues.push( `Assignment status is '${validation.assignment.status}' instead of 'PROVISIONED'` );
                recommendations.push( 'Wait for assignment provisioning to complete or check for errors' );
            }

            if ( issues.length > 0 ) {
                console.log( '\n⚠️  Issues Found:' );
                issues.forEach( ( issue, index ) => {
                    console.log( `  ${index + 1}. ${issue}` );
                } );

                console.log( '\n💡 Recommendations:' );
                recommendations.forEach( ( rec, index ) => {
                    console.log( `  ${index + 1}. ${rec}` );
                } );

                if ( options.fixIssues ) {
                    console.log( '\n🔧 Attempting to fix issues...' );
                    console.log( 'Note: Automatic issue fixing is not yet implemented.' );
                    console.log( 'Please follow the recommendations above to resolve issues manually.' );
                }
            }

            // Exit with error code if issues found
            if ( !allValid ) {
                process.exit( 1 );
            }

        } catch ( error ) {
            console.error( 'Error validating access grant:', error instanceof Error ? error.message : 'Unknown error' );
            process.exit( 1 );
        }
    } );

// list-access command - Show existing access grants
program
    .command( 'list-access' )
    .description( 'Show existing access grants following CE-AWS naming convention' )
    .option( '-t, --account-type <type>', 'Filter by account type (Dev|QA|Staging|Prod)' )
    .option( '--format <format>', 'Output format (table|json)', 'table' )
    .option( '--show-details', 'Show detailed information including validation status' )
    .action( async ( options ) => {
        try {
            let accountType: 'Dev' | 'QA' | 'Staging' | 'Prod' | undefined;

            if ( options.accountType ) {
                accountType = options.accountType as 'Dev' | 'QA' | 'Staging' | 'Prod';
                if ( ![ 'Dev', 'QA', 'Staging', 'Prod' ].includes( accountType ) ) {
                    console.error( 'Error: Account type must be one of: Dev, QA, Staging, Prod' );
                    process.exit( 1 );
                }
            }

            const orchestrator = createOrchestrator();
            const accessGrants = await orchestrator.listAccessGrants( accountType );

            if ( options.format === 'json' ) {
                console.log( JSON.stringify( accessGrants, null, 2 ) );
                return;
            }

            // Table format
            console.log( '\nAccess Grants:' );
            console.log( '==============' );

            if ( accessGrants.length === 0 ) {
                console.log( 'No access grants found.' );
                if ( accountType ) {
                    console.log( `(Filtered by account type: ${accountType})` );
                }
                return;
            }

            for ( const grant of accessGrants ) {
                // Parse group name to extract details
                const nameParts = grant.groupName.split( '-' );
                const grantAccountType = nameParts.length >= 3 ? nameParts[ 2 ] : 'Unknown';
                const ticketId = nameParts.length >= 4 ? nameParts[ 3 ] : 'Unknown';

                console.log( `\nGroup: ${grant.groupName}` );
                console.log( `Account Type: ${grantAccountType}` );
                console.log( `Ticket ID: ${ticketId}` );
                console.log( `Azure Group ID: ${grant.azureGroupId}` );
                console.log( `AWS Account: ${grant.awsAccountId}` );
                console.log( `Permission Set: ${grant.permissionSetArn.split( '/' ).pop()}` ); // Show just the name part
                console.log( `Status: ${grant.operation.status}` );
                console.log( `Created: ${grant.operation.startTime.toISOString()}` );

                if ( options.showDetails ) {
                    console.log( `Operation ID: ${grant.operation.operationId}` );

                    if ( grant.validationResults ) {
                        console.log( 'Validation Status:' );
                        console.log( `  Group Synced: ${grant.validationResults.groupSynced ? '✅' : '❌'}` );
                        console.log( `  Permission Set: ${grant.validationResults.permissionSetCreated ? '✅' : '❌'}` );
                        console.log( `  Assignment: ${grant.validationResults.assignmentActive ? '✅' : '❌'}` );
                        console.log( `  User Access: ${grant.validationResults.usersCanAccess ? '✅' : '❌'}` );
                    }

                    if ( grant.operation.errors.length > 0 ) {
                        console.log( 'Errors:' );
                        grant.operation.errors.forEach( error => {
                            console.log( `  - ${error.message}` );
                        } );
                    }
                }

                console.log( '---' );
            }

            console.log( `\nTotal: ${accessGrants.length} access grants` );

            // Summary by account type
            const summary = accessGrants.reduce( ( acc, grant ) => {
                const nameParts = grant.groupName.split( '-' );
                const type = nameParts.length >= 3 ? nameParts[ 2 ] : 'Unknown';
                acc[ type ] = ( acc[ type ] || 0 ) + 1;
                return acc;
            }, {} as Record<string, number> );

            if ( Object.keys( summary ).length > 1 ) {
                console.log( '\nSummary by Account Type:' );
                Object.entries( summary ).forEach( ( [ type, count ] ) => {
                    console.log( `  ${type}: ${count}` );
                } );
            }

        } catch ( error ) {
            console.error( 'Error listing access grants:', error instanceof Error ? error.message : 'Unknown error' );
            process.exit( 1 );
        }
    } );

// create-access command - Standardized access grant workflow
program
    .command( 'create-access' )
    .description( 'Create standardized access grant following CE-AWS-<Account>-<TicketId> naming convention' )
    .requiredOption( '-t, --account-type <type>', 'Account type (Dev|QA|Staging|Prod)' )
    .requiredOption( '--ticket-id <ticketId>', 'Ticket ID in format AG-XXX or AG-XXXX' )
    .requiredOption( '--owners <owners>', 'Comma-separated list of owner email addresses' )
    .requiredOption( '--members <members>', 'Comma-separated list of member email addresses' )
    .option( '--template <template>', 'Permission set template name' )
    .option( '--description <description>', 'Custom description for the access grant' )
    .option( '--session-duration <duration>', 'Session duration (e.g., PT1H, PT8H)', 'PT1H' )
    .option( '--managed-policies <policies>', 'Comma-separated list of managed policy ARNs' )
    .option( '--inline-policy <policy>', 'Inline policy JSON string' )
    .option( '--dry-run', 'Show what would be created without making changes' )
    .action( async ( options ) => {
        try {
            // Parse and validate inputs
            const accountType = options.accountType as 'Dev' | 'QA' | 'Staging' | 'Prod';
            if ( ![ 'Dev', 'QA', 'Staging', 'Prod' ].includes( accountType ) ) {
                console.error( 'Error: Account type must be one of: Dev, QA, Staging, Prod' );
                process.exit( 1 );
            }

            if ( !/^AG-\d{3,4}$/.test( options.ticketId ) ) {
                console.error( 'Error: Ticket ID must be in format AG-XXX or AG-XXXX' );
                process.exit( 1 );
            }

            const owners = options.owners.split( ',' ).map( ( email: string ) => email.trim() );
            const members = options.members.split( ',' ).map( ( email: string ) => email.trim() );

            // Validate email formats
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            const allEmails = [ ...owners, ...members ];
            for ( const email of allEmails ) {
                if ( !emailRegex.test( email ) ) {
                    console.error( `Error: Invalid email format: ${email}` );
                    process.exit( 1 );
                }
            }

            // Build access grant request
            const request: AccessGrantRequest = {
                accountType,
                ticketId: options.ticketId,
                owners,
                members,
                description: options.description
            };

            if ( options.template ) {
                request.permissionTemplate = options.template;
            }

            if ( options.managedPolicies || options.inlinePolicy || options.sessionDuration !== 'PT1H' ) {
                request.customPermissions = {};

                if ( options.managedPolicies ) {
                    request.customPermissions.managedPolicies = options.managedPolicies.split( ',' ).map( ( arn: string ) => arn.trim() );
                }

                if ( options.inlinePolicy ) {
                    try {
                        JSON.parse( options.inlinePolicy ); // Validate JSON
                        request.customPermissions.inlinePolicy = options.inlinePolicy;
                    } catch ( error ) {
                        console.error( 'Error: Inline policy must be valid JSON' );
                        process.exit( 1 );
                    }
                }

                if ( options.sessionDuration !== 'PT1H' ) {
                    request.customPermissions.sessionDuration = options.sessionDuration;
                }
            }

            const groupName = `CE-AWS-${accountType}-${options.ticketId}`;

            if ( options.dryRun ) {
                console.log( 'DRY RUN - No changes will be made' );
                console.log( '\nAccess Grant Configuration:' );
                console.log( '===========================' );
                console.log( `Group Name: ${groupName}` );
                console.log( `Account Type: ${accountType}` );
                console.log( `Ticket ID: ${options.ticketId}` );
                console.log( `Owners: ${owners.join( ', ' )}` );
                console.log( `Members: ${members.join( ', ' )}` );
                console.log( `Description: ${request.description || 'Auto-generated'}` );

                if ( request.permissionTemplate ) {
                    console.log( `Permission Template: ${request.permissionTemplate}` );
                }

                if ( request.customPermissions ) {
                    console.log( 'Custom Permissions:' );
                    if ( request.customPermissions.managedPolicies ) {
                        console.log( `  Managed Policies: ${request.customPermissions.managedPolicies.join( ', ' )}` );
                    }
                    if ( request.customPermissions.inlinePolicy ) {
                        console.log( `  Inline Policy: ${request.customPermissions.inlinePolicy.length} characters` );
                    }
                    if ( request.customPermissions.sessionDuration ) {
                        console.log( `  Session Duration: ${request.customPermissions.sessionDuration}` );
                    }
                }

                // Validate that users exist
                console.log( '\nValidating users...' );
                const azureClient = createAzureClient();
                for ( const email of allEmails ) {
                    try {
                        const validation = await azureClient.validateUser( email );
                        console.log( `  ${email}: ${validation.isValid ? 'VALID' : 'INVALID'}` );
                        if ( !validation.isValid ) {
                            console.log( `    Errors: ${validation.errors.join( ', ' )}` );
                        }
                    } catch ( error ) {
                        console.log( `  ${email}: ERROR - ${error instanceof Error ? error.message : 'Unknown error'}` );
                    }
                }

                return;
            }

            console.log( `Creating access grant: ${groupName}` );
            console.log( '======================================' );

            const orchestrator = createOrchestrator();
            const result = await orchestrator.createAccessGrant( request );

            console.log( '\n✅ Access Grant Created Successfully!' );
            console.log( '====================================' );
            console.log( `Group Name: ${result.groupName}` );
            console.log( `Azure Group ID: ${result.azureGroupId}` );
            console.log( `AWS Account: ${result.awsAccountId}` );
            console.log( `Permission Set: ${result.permissionSetArn}` );
            console.log( `Operation ID: ${result.operation.operationId}` );

            if ( result.validationResults ) {
                console.log( '\nValidation Results:' );
                console.log( `  Group Synced: ${result.validationResults.groupSynced ? '✅' : '❌'}` );
                console.log( `  Permission Set Created: ${result.validationResults.permissionSetCreated ? '✅' : '❌'}` );
                console.log( `  Assignment Active: ${result.validationResults.assignmentActive ? '✅' : '❌'}` );
                console.log( `  Users Can Access: ${result.validationResults.usersCanAccess ? '✅' : '❌'}` );
            }

            console.log( '\n📋 Next Steps:' );
            console.log( '1. Verify group members can access the AWS console' );
            console.log( '2. Test permissions in the target AWS account' );
            console.log( `3. Use 'aws-ag validate-access ${groupName}' to check status` );

        } catch ( error ) {
            console.error( 'Error creating access grant:', error instanceof Error ? error.message : 'Unknown error' );
            process.exit( 1 );
        }
    } );

// Parse command line arguments
program.parse();

export { program };
