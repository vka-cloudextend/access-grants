#!/usr/bin/env node

import { Command } from 'commander';
import { AzureClient } from './clients/azure-client';
import { AWSClient } from './clients/aws-client';
import { AssignmentOrchestrator, OrchestrationConfig, AccessGrantRequest } from './orchestrator';
import { configManager, validateConfig } from './config';
import { ErrorHandler, ValidationUtils } from './errors';
import { systemIntegration, getOrchestrator, getReportingService, getValidationService } from './integration';

const program = new Command();

program
    .name( 'aws-ag' )
    .description( 'AWS Access Grants - CLI tool for managing Azure AD security groups within AWS IAM Identity Center integration' )
    .version( '1.0.0' );

// Configuration helper with comprehensive validation
function getConfig(): OrchestrationConfig {
    // Validate configuration
    const validation = validateConfig();

    if ( !validation.isValid ) {
        console.error( 'Configuration validation failed:' );
        validation.errors.forEach( error => {
            console.error( `  - ${error}` );
        } );

        if ( validation.warnings.length > 0 ) {
            console.warn( '\nWarnings:' );
            validation.warnings.forEach( warning => {
                console.warn( `  - ${warning}` );
            } );
        }

        console.error( '\nPlease check your environment variables or configuration files.' );
        console.error( 'Use "aws-ag config --template" to generate a configuration template.' );
        process.exit( 1 );
    }

    // Show warnings if any
    if ( validation.warnings.length > 0 ) {
        console.warn( 'Configuration warnings:' );
        validation.warnings.forEach( warning => {
            console.warn( `  - ${warning}` );
        } );
        console.warn( '' );
    }

    const config = configManager.getConfig();

    return {
        azure: config.azure,
        aws: config.aws,
        retryAttempts: config.retry.maxAttempts,
        retryDelayMs: config.retry.baseDelayMs
    };
}

// Helper to create orchestrator instance
async function createOrchestrator(): Promise<AssignmentOrchestrator> {
    return await getOrchestrator();
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

// config command - Configuration management
program
    .command( 'config' )
    .description( 'Configuration management' )
    .option( '--validate', 'Validate current configuration' )
    .option( '--show', 'Show current configuration (masked)' )
    .option( '--sources', 'Show configuration sources' )
    .option( '--template', 'Generate configuration template' )
    .option( '--env-template', 'Generate environment variables template' )
    .option( '--setup-global', 'Setup global user configuration directory and templates' )
    .action( async ( options ) => {
        try {
            if ( options.setupGlobal ) {
                console.log( 'Setting up global user configuration...' );
                console.log( '=====================================' );

                const result = configManager.setupUserConfig();

                if ( result.success ) {
                    console.log( `✅ ${result.message}` );

                    if ( result.paths.length > 0 ) {
                        console.log( '\nCreated files:' );
                        result.paths.forEach( path => {
                            console.log( `  📁 ${path}` );
                        } );
                    }

                    console.log( '\n📝 Next steps:' );
                    console.log( '1. Edit ~/.aws-ag/.env with your actual configuration values' );
                    console.log( '2. Or edit ~/.aws-ag/config.json for JSON-based configuration' );
                    console.log( '3. Run "aws-ag config --validate" to verify your setup' );
                    console.log( '\n🔐 For enhanced security (optional):' );
                    console.log( '4. Encrypt your global .env file:' );
                    console.log( '   cd ~/.aws-ag && npx dotenvx encrypt' );
                    console.log( '5. Keep the .env.keys file secure and backed up' );
                    console.log( '\n💡 The global configuration will be used when running aws-ag from any directory' );
                } else {
                    console.error( `❌ ${result.message}` );
                    process.exit( 1 );
                }
                return;
            }
            if ( options.template ) {
                console.log( 'Configuration template (config.json):' );
                console.log( '=====================================' );
                console.log( configManager.createConfigTemplate() );
                return;
            }

            if ( options.envTemplate ) {
                console.log( 'Environment variables template (.env):' );
                console.log( '=====================================' );
                console.log( configManager.createEnvTemplate() );
                return;
            }

            if ( options.sources ) {
                console.log( 'Configuration sources (in priority order):' );
                console.log( '=========================================' );
                const sources = configManager.getConfigSources();
                sources.forEach( ( source, index ) => {
                    console.log( `${index + 1}. ${source}` );
                } );

                // Show encryption information
                const encryptionInfo = configManager.getEncryptionInfo();
                console.log( '\n🔐 Encryption Status:' );
                console.log( '===================' );
                console.log( `User config encrypted: ${encryptionInfo.userEnvEncrypted ? '✅ Yes' : '❌ No'}` );
                console.log( `Project config encrypted: ${encryptionInfo.projectEnvEncrypted ? '✅ Yes' : '❌ No'}` );
                console.log( `User keys available: ${encryptionInfo.userKeysExists ? '✅ Yes' : '❌ No'}` );
                console.log( `Project keys available: ${encryptionInfo.projectKeysExists ? '✅ Yes' : '❌ No'}` );

                if ( encryptionInfo.userEnvEncrypted && !encryptionInfo.userKeysExists ) {
                    console.log( '\n⚠️  Warning: User .env file is encrypted but .env.keys not found!' );
                    console.log( `   Copy your .env.keys file to: ${encryptionInfo.userConfigDir}/.env.keys` );
                }

                return;
            }

            if ( options.show ) {
                console.log( 'Current configuration (sensitive values masked):' );
                console.log( '===============================================' );
                console.log( JSON.stringify( configManager.getMaskedConfig(), null, 2 ) );
                return;
            }

            // Default: validate configuration
            const validation = validateConfig();

            console.log( 'Configuration Validation:' );
            console.log( '========================' );
            console.log( `Status: ${validation.isValid ? '✅ Valid' : '❌ Invalid'}` );

            if ( validation.errors.length > 0 ) {
                console.log( '\nErrors:' );
                validation.errors.forEach( error => {
                    console.log( `  ❌ ${error}` );
                } );
            }

            if ( validation.warnings.length > 0 ) {
                console.log( '\nWarnings:' );
                validation.warnings.forEach( warning => {
                    console.log( `  ⚠️  ${warning}` );
                } );
            }

            if ( validation.isValid ) {
                console.log( '\n✅ Configuration is valid and ready to use!' );
            } else {
                console.log( '\n❌ Please fix the configuration errors before using the tool.' );
                console.log( 'Use "aws-ag config --template" to generate a configuration template.' );
                process.exit( 1 );
            }

        } catch ( error ) {
            ErrorHandler.handleError( error, 'Configuration management' );
        }
    } );

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
            ErrorHandler.handleError( error, 'Discovering groups' );
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
            ErrorHandler.handleError( error, 'Listing permission sets' );
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
            const orchestrator = await createOrchestrator();

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
            ErrorHandler.handleError( error, 'Assigning group' );
        } finally {
            // Ensure the process exits cleanly
            process.exit( 0 );
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

            const orchestrator = await createOrchestrator();

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
            ErrorHandler.handleError( error, 'Bulk assignment' );
        } finally {
            // Ensure the process exits cleanly
            process.exit( 0 );
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
            ErrorHandler.handleError( error, 'Listing assignments' );
        }
    } );

// validate-assignments command - Test assignment functionality
program
    .command( 'validate-assignments' )
    .description( 'Test assignment functionality' )
    .option( '-g, --group-id <groupId>', 'Validate specific group assignment' )
    .option( '-a, --account <accountId>', 'Validate assignments for specific account' )
    .option( '--format <format>', 'Output format (table|json)', 'table' )
    .action( async ( options ) => {
        try {
            const validationService = await getValidationService();

            if ( !validationService ) {
                console.error( 'Validation service not available. Please check configuration.' );
                process.exit( 1 );
            }

            if ( options.groupId ) {
                // Validate specific group
                console.log( `🔍 Validating group ${options.groupId}...` );

                const syncStatus = await validationService.checkGroupSynchronizationStatus( options.groupId );

                if ( options.format === 'json' ) {
                    console.log( JSON.stringify( syncStatus, null, 2 ) );
                    return;
                }

                console.log( `\n📊 Group Synchronization Status:` );
                console.log( `Azure Group ID: ${syncStatus.azureGroupId}` );
                console.log( `Azure Group Name: ${syncStatus.azureGroupName}` );
                console.log( `Synchronized: ${syncStatus.isSynced ? '✅' : '❌'}` );

                if ( syncStatus.awsGroupId ) {
                    console.log( `AWS Group ID: ${syncStatus.awsGroupId}` );
                }

                if ( syncStatus.lastSyncTime ) {
                    console.log( `Last Sync: ${syncStatus.lastSyncTime.toISOString()}` );
                }

                console.log( `\n👥 Member Count:` );
                console.log( `Azure: ${syncStatus.memberCount.azure}` );
                if ( syncStatus.memberCount.aws !== undefined ) {
                    console.log( `AWS: ${syncStatus.memberCount.aws}` );
                }

                if ( syncStatus.syncErrors.length > 0 ) {
                    console.log( `\n❌ Sync Errors:` );
                    syncStatus.syncErrors.forEach( ( error, index ) => {
                        console.log( `  ${index + 1}. ${error}` );
                    } );
                }

            } else if ( options.account ) {
                // Validate assignments for specific account
                console.log( `🔍 Validating assignments for account ${options.account}...` );

                const awsClient = createAWSClient();
                const assignments = await awsClient.getAccountAssignmentsForAccount( options.account );

                console.log( `\n📊 Found ${assignments.length} assignments` );

                for ( const assignment of assignments ) {
                    if ( assignment.principalType === 'GROUP' ) {
                        console.log( `\n🔍 Validating group assignment: ${assignment.principalId}` );

                        const syncStatus = await validationService.checkGroupSynchronizationStatus( assignment.principalId );
                        console.log( `  Sync Status: ${syncStatus.isSynced ? '✅ SYNCED' : '❌ NOT SYNCED'}` );
                        console.log( `  Assignment Status: ${assignment.status}` );

                        if ( syncStatus.syncErrors.length > 0 ) {
                            console.log( `  Errors: ${syncStatus.syncErrors.join( ', ' )}` );
                        }
                    }
                }

            } else {
                // General validation using validation service
                console.log( '🔍 Performing comprehensive assignment validation...' );

                const validationSummary = await validationService.validateAllAssignments();

                if ( options.format === 'json' ) {
                    console.log( JSON.stringify( validationSummary, null, 2 ) );
                    return;
                }

                console.log( `\n📊 Validation Summary:` );
                console.log( `Total Assignments: ${validationSummary.totalAssignments}` );
                console.log( `Valid Assignments: ${validationSummary.validAssignments} ✅` );
                console.log( `Invalid Assignments: ${validationSummary.invalidAssignments} ❌` );

                if ( validationSummary.issues.length > 0 ) {
                    console.log( `\n⚠️  Issues Found:` );
                    validationSummary.issues.forEach( ( issue, index ) => {
                        console.log( `\n${index + 1}. Assignment Issue:` );
                        console.log( `   Group: ${issue.assignment.azureGroupId}` );
                        console.log( `   Account: ${issue.assignment.awsAccountId}` );

                        if ( issue.errors.length > 0 ) {
                            console.log( `   Errors:` );
                            issue.errors.forEach( error => console.log( `     - ${error}` ) );
                        }

                        if ( issue.warnings.length > 0 ) {
                            console.log( `   Warnings:` );
                            issue.warnings.forEach( warning => console.log( `     - ${warning}` ) );
                        }
                    } );
                }

                if ( validationSummary.invalidAssignments > 0 ) {
                    console.log( `\n💡 Run with --group-id <id> to get detailed validation for specific groups` );
                    process.exit( 1 );
                }
            }
        } catch ( error ) {
            ErrorHandler.handleError( error, 'Validating assignments' );
        } finally {
            // Ensure the process exits cleanly
            process.exit( 0 );
        }
    } );

// export-config command - Export current configuration
program
    .command( 'export-config' )
    .description( 'Export current configuration' )
    .option( '-o, --output <file>', 'Output file (default: stdout)' )
    .option( '--include-assignments', 'Include current assignments in export' )
    .option( '--include-reports', 'Include system reports in export' )
    .action( async ( options ) => {
        try {
            const config = getConfig();
            const awsClient = createAWSClient();
            const reportingService = await getReportingService();

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

            // Enhanced export with reporting service
            if ( options.includeReports && reportingService ) {
                try {
                    console.log( '📊 Including system reports in export...' );

                    const [ assignmentReport, healthReport ] = await Promise.all( [
                        reportingService.generateAssignmentSummariesAndReports(),
                        reportingService.generateSystemHealthReport()
                    ] );

                    exportData.reports = {
                        assignmentSummary: assignmentReport.summary,
                        systemHealth: healthReport,
                        generatedAt: new Date().toISOString()
                    };

                    console.log( '✅ System reports included in export' );
                } catch ( error ) {
                    console.warn( `⚠️  Failed to include reports: ${error instanceof Error ? error.message : 'Unknown error'}` );
                }
            } else if ( options.includeReports ) {
                console.warn( '⚠️  Reporting service not available, skipping reports' );
            }

            const output = JSON.stringify( exportData, null, 2 );

            if ( options.output ) {
                const fs = await import( 'fs/promises' );
                await fs.writeFile( options.output, output );
                console.log( `✅ Configuration exported to ${options.output}` );

                if ( exportData.reports ) {
                    console.log( `📊 Export includes system reports and health data` );
                }
            } else {
                console.log( output );
            }
        } catch ( error ) {
            ErrorHandler.handleError( error, 'Exporting configuration' );
        } finally {
            // Ensure the process exits cleanly
            process.exit( 0 );
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
            const orchestrator = await createOrchestrator();

            const operation = await orchestrator.getOperationStatus( options.operationId );
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
            ErrorHandler.handleError( error, 'Performing rollback' );
        } finally {
            // Ensure the process exits cleanly
            process.exit( 0 );
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
            ValidationUtils.validateGroupName( groupName );

            const nameParts = groupName.split( '-' );
            const accountType = nameParts[ 2 ];
            const ticketId = `${nameParts[ 3 ]}-${nameParts[ 4 ]}`;

            console.log( `Validating access grant: ${groupName}` );
            console.log( '=======================================' );

            const orchestrator = await createOrchestrator();
            const validationService = await getValidationService();

            if ( !validationService ) {
                console.warn( '⚠️  Validation service not available, using basic validation' );
            }

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

            // Enhanced validation with validation service
            if ( validationService && validation.azureGroup.exists ) {
                try {
                    console.log( '\n🔄 Enhanced Synchronization Analysis:' );
                    // Note: This would need the actual Azure group ID from the validation
                    // For now, we'll show that the service is available but skip the detailed check
                    console.log( '  Enhanced validation service available ✅' );
                    console.log( '  (Detailed sync analysis requires group ID from Azure)' );
                } catch ( error ) {
                    console.log( `  Enhanced validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` );
                }
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
            ErrorHandler.handleError( error, 'Validating access grant' );
        } finally {
            // Ensure the process exits cleanly
            process.exit( 0 );
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
                ValidationUtils.validateAccountType( accountType );
            }

            const orchestrator = await createOrchestrator();
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
            ErrorHandler.handleError( error, 'Listing access grants' );
        } finally {
            // Ensure the process exits cleanly
            process.exit( 0 );
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
            ValidationUtils.validateAccountType( accountType );
            ValidationUtils.validateTicketId( options.ticketId );

            const owners = options.owners.split( ',' ).map( ( email: string ) => email.trim() );
            const members = options.members.split( ',' ).map( ( email: string ) => email.trim() );

            // Validate email formats
            const allEmails = [ ...owners, ...members ];
            for ( const email of allEmails ) {
                ValidationUtils.validateEmail( email );
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

            const orchestrator = await createOrchestrator();
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
            ErrorHandler.handleError( error, 'Creating access grant' );
        } finally {
            // Ensure the process exits cleanly
            process.exit( 0 );
        }
    } );

// health command - System health check
program
    .command( 'health' )
    .description( 'Check system health and component status' )
    .option( '--detailed', 'Show detailed health information' )
    .option( '--format <format>', 'Output format (table|json)', 'table' )
    .action( async ( options ) => {
        try {
            console.log( '🏥 Performing system health check...' );

            const healthCheck = await systemIntegration.performHealthCheck();
            const stats = await systemIntegration.getIntegrationStatistics();

            if ( options.format === 'json' ) {
                console.log( JSON.stringify( {
                    health: healthCheck,
                    statistics: stats
                }, null, 2 ) );
                return;
            }

            // Table format
            console.log( '\n🏥 System Health Report' );
            console.log( '======================' );
            console.log( `Overall Status: ${healthCheck.healthy ? '✅ HEALTHY' : '❌ UNHEALTHY'}` );
            console.log( `Uptime: ${Math.round( stats.uptime / 1000 / 60 )} minutes` );
            console.log( `Operations Processed: ${stats.operationsProcessed}` );
            console.log( `Errors Encountered: ${stats.errorsEncountered}` );

            console.log( '\n📊 Component Status:' );
            console.log( `Orchestrator: ${healthCheck.status.orchestrator.initialized ? '✅' : '❌'} (${healthCheck.status.orchestrator.operationsCount} operations)` );
            console.log( `Reporting: ${healthCheck.status.reporting.initialized ? '✅' : '❌'}` );
            console.log( `Validation: ${healthCheck.status.validation.initialized ? '✅' : '❌'}` );
            console.log( `Storage: ${healthCheck.status.storage.initialized ? '✅' : '❌'} (${healthCheck.status.storage.operationsStored} stored)` );

            if ( options.detailed ) {
                console.log( '\n💾 Memory Usage:' );
                console.log( `RSS: ${Math.round( stats.memoryUsage.rss / 1024 / 1024 )}MB` );
                console.log( `Heap Used: ${Math.round( stats.memoryUsage.heapUsed / 1024 / 1024 )}MB` );
                console.log( `Heap Total: ${Math.round( stats.memoryUsage.heapTotal / 1024 / 1024 )}MB` );
                console.log( `External: ${Math.round( stats.memoryUsage.external / 1024 / 1024 )}MB` );

                // Show component errors if any
                const allErrors = [
                    ...healthCheck.status.orchestrator.errors,
                    ...healthCheck.status.reporting.errors,
                    ...healthCheck.status.validation.errors,
                    ...healthCheck.status.storage.errors
                ];

                if ( allErrors.length > 0 ) {
                    console.log( '\n❌ Component Errors:' );
                    allErrors.forEach( ( error, index ) => {
                        console.log( `  ${index + 1}. ${error}` );
                    } );
                }
            }

            if ( healthCheck.recommendations.length > 0 ) {
                console.log( '\n💡 Recommendations:' );
                healthCheck.recommendations.forEach( ( rec, index ) => {
                    console.log( `  ${index + 1}. ${rec}` );
                } );
            }

            if ( !healthCheck.healthy ) {
                process.exit( 1 );
            }

        } catch ( error ) {
            ErrorHandler.handleError( error, 'Health check' );
        } finally {
            // Ensure the process exits cleanly
            process.exit( 0 );
        }
    } );

// reports command - Generate system reports
program
    .command( 'reports' )
    .description( 'Generate comprehensive system reports' )
    .option( '--assignment-report', 'Generate assignment summary report' )
    .option( '--audit-report', 'Generate audit log report' )
    .option( '--health-report', 'Generate system health report' )
    .option( '--all', 'Generate all available reports' )
    .option( '--format <format>', 'Output format (table|json)', 'table' )
    .option( '-o, --output <directory>', 'Output directory for report files' )
    .action( async ( options ) => {
        try {
            const reportingService = await getReportingService();

            if ( !reportingService ) {
                console.error( '❌ Reporting service not available. Please check configuration.' );
                process.exit( 1 );
            }

            const generateAll = options.all || ( !options.assignmentReport && !options.auditReport && !options.healthReport );

            console.log( '📊 Generating system reports...' );

            // Assignment Report
            if ( options.assignmentReport || generateAll ) {
                try {
                    console.log( '\n📋 Generating assignment report...' );
                    const assignmentReport = await reportingService.generateAssignmentSummariesAndReports();

                    if ( options.format === 'json' ) {
                        console.log( JSON.stringify( assignmentReport.summary, null, 2 ) );
                    } else {
                        console.log( '\n📊 Assignment Summary:' );
                        console.log( `Total Assignments: ${assignmentReport.summary.totalAssignments}` );
                        console.log( `Total Assignments: ${assignmentReport.summary.totalAssignments}` );
                        console.log( `Active Assignments: ${assignmentReport.summary.activeAssignments}` );
                        console.log( `Failed Assignments: ${assignmentReport.summary.failedAssignments}` );

                        if ( assignmentReport.exportPath ) {
                            console.log( `📄 Detailed report saved to: ${assignmentReport.exportPath}` );
                        }
                    }
                } catch ( error ) {
                    console.error( `❌ Assignment report failed: ${error instanceof Error ? error.message : 'Unknown error'}` );
                }
            }

            // Health Report
            if ( options.healthReport || generateAll ) {
                try {
                    console.log( '\n🏥 Generating system health report...' );
                    const healthReport = await reportingService.generateSystemHealthReport();

                    if ( options.format === 'json' ) {
                        console.log( JSON.stringify( healthReport, null, 2 ) );
                    } else {
                        console.log( '\n🏥 System Health Status:' );
                        console.log( `Overall Health: ${healthReport.overallHealth}` );

                        console.log( '\n🔗 Azure Connectivity:' );
                        console.log( `  Connected: ${healthReport.azureHealth.connected ? '✅' : '❌'}` );
                        console.log( `  Groups Found: ${healthReport.azureHealth.groupCount}` );
                        if ( healthReport.azureHealth.errors.length > 0 ) {
                            console.log( `  Errors: ${healthReport.azureHealth.errors.join( ', ' )}` );
                        }

                        console.log( '\n☁️  AWS Connectivity:' );
                        console.log( `  Connected: ${healthReport.awsHealth.connected ? '✅' : '❌'}` );
                        console.log( `  Permission Sets: ${healthReport.awsHealth.permissionSetCount}` );
                        console.log( `  Accounts: ${healthReport.awsHealth.accountCount}` );
                        console.log( `  Assignments: ${healthReport.awsHealth.assignmentCount}` );
                        if ( healthReport.awsHealth.errors.length > 0 ) {
                            console.log( `  Errors: ${healthReport.awsHealth.errors.join( ', ' )}` );
                        }

                        console.log( '\n🔄 Synchronization Health:' );
                        console.log( `  Synced Groups: ${healthReport.synchronizationHealth.syncedGroups}` );
                        console.log( `  Unsynced Groups: ${healthReport.synchronizationHealth.unsyncedGroups}` );
                        if ( healthReport.synchronizationHealth.syncErrors.length > 0 ) {
                            console.log( `  Sync Errors: ${healthReport.synchronizationHealth.syncErrors.length}` );
                        }
                    }
                } catch ( error ) {
                    console.error( `❌ Health report failed: ${error instanceof Error ? error.message : 'Unknown error'}` );
                }
            }

            // Audit Report
            if ( options.auditReport || generateAll ) {
                try {
                    console.log( '\n📜 Generating audit report...' );
                    const auditReport = await reportingService.generateAuditReport();

                    if ( options.format === 'json' ) {
                        console.log( JSON.stringify( auditReport.summary, null, 2 ) );
                    } else {
                        console.log( '\n📜 Audit Summary:' );
                        console.log( `Total Entries: ${auditReport.summary.totalEntries}` );
                        console.log( `Success Rate: ${auditReport.summary.successRate.toFixed( 1 )}%` );
                        console.log( `Failure Rate: ${auditReport.summary.failureRate.toFixed( 1 )}%` );
                        console.log( `Time Range: ${auditReport.summary.timeRange.start.toISOString()} - ${auditReport.summary.timeRange.end.toISOString()}` );

                        if ( Object.keys( auditReport.summary.operationsByType ).length > 0 ) {
                            console.log( '\n📊 Operations by Type:' );
                            Object.entries( auditReport.summary.operationsByType ).forEach( ( [ type, count ] ) => {
                                console.log( `  ${type}: ${count}` );
                            } );
                        }
                    }
                } catch ( error ) {
                    console.error( `❌ Audit report failed: ${error instanceof Error ? error.message : 'Unknown error'}` );
                }
            }

            console.log( '\n✅ Report generation completed' );

        } catch ( error ) {
            ErrorHandler.handleError( error, 'Generating reports' );
        } finally {
            // Ensure the process exits cleanly
            process.exit( 0 );
        }
    } );

// Parse command line arguments
program.parse();

export { program };
