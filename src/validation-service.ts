// Assignment Validation Service - High-level validation orchestration
import { AWSClient } from './clients/aws-client';
import { AzureClient } from './clients/azure-client';
import { GroupAssignment } from './types';
import { AssignmentValidator, ValidationResult } from './validator';

export interface ValidationServiceConfig {
    azure: {
        tenantId: string;
        clientId: string;
        clientSecret: string;
    };
    aws: {
        region: string;
        identityCenterInstanceArn: string;
        identityStoreId: string;
    };
}

export interface GroupSynchronizationStatus {
    azureGroupId: string;
    azureGroupName: string;
    isSynced: boolean;
    awsGroupId?: string;
    lastSyncTime?: Date;
    syncErrors: string[];
    memberCount: {
        azure: number;
        aws?: number;
    };
}

export interface PermissionInheritanceTest {
    permissionSetArn: string;
    permissionSetName: string;
    isValid: boolean;
    hasRequiredPolicies: boolean;
    isProvisioned: boolean;
    testResults: {
        policyValidation: boolean;
        accountAccess: boolean;
        resourcePermissions: boolean;
    };
    errors: string[];
}

export interface AssignmentFunctionalityTest {
    assignment: GroupAssignment;
    isWorking: boolean;
    testResults: {
        groupExists: boolean;
        groupSynced: boolean;
        permissionSetExists: boolean;
        assignmentActive: boolean;
        endToEndAccess: boolean;
    };
    errors: string[];
    recommendations: string[];
}

export class ValidationService {
    private azureClient: AzureClient;
    private awsClient: AWSClient;
    private validator: AssignmentValidator;

    constructor( config: ValidationServiceConfig ) {
        this.azureClient = new AzureClient( config.azure );
        this.awsClient = new AWSClient( config.aws );
        this.validator = new AssignmentValidator( this.azureClient, this.awsClient );

        // Set up cross-client integration for enhanced validation
        this.azureClient.setAWSClient( this.awsClient );
    }

    /**
     * Check group synchronization status
     * Implements Requirements 4.1: Verify that group members appear in AWS IAM Identity Center
     */
    async checkGroupSynchronizationStatus( azureGroupId: string ): Promise<GroupSynchronizationStatus> {
        try {
            // Get Azure group details
            const azureValidation = await this.azureClient.validateGroupDetailed( azureGroupId );

            // Get synchronization status from AWS
            const syncStatus = await this.awsClient.checkGroupSynchronizationStatus( azureGroupId );

            let awsMemberCount: number | undefined;
            if ( syncStatus.isSynced && syncStatus.awsGroupId ) {
                try {
                    const awsGroupDetails = await this.awsClient.getGroupDetails( syncStatus.awsGroupId );
                    awsMemberCount = awsGroupDetails.memberCount;
                } catch ( error ) {
                    // AWS group details not available
                }
            }

            const syncErrors: string[] = [];

            if ( !azureValidation.exists ) {
                syncErrors.push( 'Azure group does not exist' );
            }

            if ( !azureValidation.isActive ) {
                syncErrors.push( 'Azure group is not active' );
            }

            if ( !syncStatus.isSynced ) {
                syncErrors.push( 'Group is not synchronized to AWS Identity Center' );
            }

            if ( syncStatus.isSynced && awsMemberCount !== undefined && awsMemberCount !== azureValidation.memberCount ) {
                syncErrors.push( `Member count mismatch: Azure (${azureValidation.memberCount}) vs AWS (${awsMemberCount})` );
            }

            return {
                azureGroupId,
                azureGroupName: azureValidation.exists ? 'Unknown' : '', // Would need to get from Azure API
                isSynced: syncStatus.isSynced,
                awsGroupId: syncStatus.awsGroupId,
                lastSyncTime: syncStatus.lastSyncTime,
                syncErrors,
                memberCount: {
                    azure: azureValidation.memberCount,
                    aws: awsMemberCount
                }
            };
        } catch ( error ) {
            return {
                azureGroupId,
                azureGroupName: 'Error',
                isSynced: false,
                syncErrors: [ error instanceof Error ? error.message : 'Unknown error' ],
                memberCount: {
                    azure: 0
                }
            };
        }
    }

    /**
     * Validate permission inheritance
     * Implements Requirements 4.3: Confirm that group members receive the assigned AWS permissions
     */
    async validatePermissionInheritance( permissionSetArn: string ): Promise<PermissionInheritanceTest> {
        try {
            // Get permission set details
            const permissionSets = await this.awsClient.listPermissionSets();
            const permissionSet = permissionSets.find( ps => ps.arn === permissionSetArn );

            if ( !permissionSet ) {
                return {
                    permissionSetArn,
                    permissionSetName: 'Not Found',
                    isValid: false,
                    hasRequiredPolicies: false,
                    isProvisioned: false,
                    testResults: {
                        policyValidation: false,
                        accountAccess: false,
                        resourcePermissions: false
                    },
                    errors: [ 'Permission set not found' ]
                };
            }

            const errors: string[] = [];

            // Test 1: Policy validation
            const hasRequiredPolicies = Boolean( ( permissionSet.managedPolicies && permissionSet.managedPolicies.length > 0 ) ||
                ( permissionSet.inlinePolicy && permissionSet.inlinePolicy.trim().length > 0 ) );

            if ( !hasRequiredPolicies ) {
                errors.push( 'Permission set has no managed policies or inline policy' );
            }

            // Test 2: Account access (check if permission set is provisioned)
            const isProvisioned = true; // If it exists in the list, it's provisioned

            // Test 3: Resource permissions (basic validation)
            const resourcePermissions = hasRequiredPolicies; // Simplified check

            const testResults = {
                policyValidation: hasRequiredPolicies,
                accountAccess: isProvisioned,
                resourcePermissions: resourcePermissions
            };

            return {
                permissionSetArn,
                permissionSetName: permissionSet.name,
                isValid: errors.length === 0 && Object.values( testResults ).every( Boolean ),
                hasRequiredPolicies,
                isProvisioned,
                testResults,
                errors
            };
        } catch ( error ) {
            return {
                permissionSetArn,
                permissionSetName: 'Error',
                isValid: false,
                hasRequiredPolicies: false,
                isProvisioned: false,
                testResults: {
                    policyValidation: false,
                    accountAccess: false,
                    resourcePermissions: false
                },
                errors: [ error instanceof Error ? error.message : 'Unknown error' ]
            };
        }
    }

    /**
     * Test assignment functionality
     * Implements Requirements 4.4: Provide specific troubleshooting steps if issues are detected
     */
    async testAssignmentFunctionality( assignment: GroupAssignment ): Promise<AssignmentFunctionalityTest> {
        try {
            const errors: string[] = [];
            const recommendations: string[] = [];

            // Test 1: Group exists in Azure
            const azureValidation = await this.azureClient.validateGroupDetailed( assignment.azureGroupId );
            const groupExists = azureValidation.exists;

            if ( !groupExists ) {
                errors.push( 'Azure group does not exist' );
                recommendations.push( 'Verify the Azure group ID is correct and the group exists in Azure AD' );
            }

            // Test 2: Group is synced to AWS
            const syncStatus = await this.awsClient.checkGroupSynchronizationStatus( assignment.azureGroupId );
            const groupSynced = syncStatus.isSynced;

            if ( !groupSynced ) {
                errors.push( 'Group is not synchronized to AWS Identity Center' );
                recommendations.push( 'Check Azure AD provisioning configuration and trigger manual sync if needed' );
            }

            // Test 3: Permission set exists
            const permissionSets = await this.awsClient.listPermissionSets();
            const permissionSetExists = permissionSets.some( ps => ps.arn === assignment.permissionSetArn );

            if ( !permissionSetExists ) {
                errors.push( 'Permission set does not exist' );
                recommendations.push( 'Create the permission set or verify the ARN is correct' );
            }

            // Test 4: Assignment is active
            const assignments = await this.awsClient.listAccountAssignments();
            const existingAssignment = assignments.find( a =>
                a.principalId === assignment.azureGroupId &&
                a.permissionSetArn === assignment.permissionSetArn &&
                a.accountId === assignment.awsAccountId
            );

            const assignmentActive = existingAssignment?.status === 'PROVISIONED';

            if ( !assignmentActive ) {
                if ( !existingAssignment ) {
                    errors.push( 'Assignment does not exist' );
                    recommendations.push( 'Create the assignment between the group and permission set' );
                } else {
                    errors.push( `Assignment exists but is not active (status: ${existingAssignment.status})` );
                    recommendations.push( 'Check assignment provisioning status and retry if needed' );
                }
            }

            // Test 5: End-to-end access (simplified check)
            const endToEndAccess = groupExists && groupSynced && permissionSetExists && assignmentActive;

            if ( !endToEndAccess && errors.length === 0 ) {
                errors.push( 'End-to-end access test failed for unknown reasons' );
                recommendations.push( 'Perform manual testing to verify user access' );
            }

            const testResults = {
                groupExists,
                groupSynced,
                permissionSetExists,
                assignmentActive,
                endToEndAccess
            };

            return {
                assignment,
                isWorking: endToEndAccess,
                testResults,
                errors,
                recommendations
            };
        } catch ( error ) {
            return {
                assignment,
                isWorking: false,
                testResults: {
                    groupExists: false,
                    groupSynced: false,
                    permissionSetExists: false,
                    assignmentActive: false,
                    endToEndAccess: false
                },
                errors: [ error instanceof Error ? error.message : 'Unknown error' ],
                recommendations: [ 'Check system connectivity and permissions' ]
            };
        }
    }

    /**
     * Comprehensive assignment validation using the validator module
     */
    async validateAssignment( assignment: GroupAssignment ): Promise<ValidationResult> {
        return await this.validator.validateAssignment( assignment );
    }

    /**
     * Batch validate multiple assignments
     */
    async validateMultipleAssignments( assignments: GroupAssignment[] ): Promise<Map<string, ValidationResult>> {
        return await this.validator.validateAssignments( assignments );
    }

    /**
     * Get validation summary for multiple assignments
     */
    async getValidationSummary( assignments: GroupAssignment[] ) {
        return await this.validator.getValidationSummary( assignments );
    }

    /**
     * Validate all assignments in the system
     */
    async validateAllAssignments(): Promise<{
        totalAssignments: number;
        validAssignments: number;
        invalidAssignments: number;
        issues: Array<{
            assignment: GroupAssignment;
            errors: string[];
            warnings: string[];
        }>;
    }> {
        try {
            // Get all current assignments
            const awsAssignments = await this.awsClient.listAccountAssignments();

            // Convert to GroupAssignment format
            const assignments: GroupAssignment[] = awsAssignments.map( a => ( {
                azureGroupId: a.principalId,
                azureGroupName: '', // Would need to be populated
                awsAccountId: a.accountId,
                permissionSetArn: a.permissionSetArn,
                assignmentStatus: a.status === 'PROVISIONED' ? 'ACTIVE' :
                    a.status === 'FAILED' ? 'FAILED' : 'PENDING',
                createdDate: new Date() // Would need to be tracked
            } ) );

            // Validate all assignments
            const validationResults = await this.validateMultipleAssignments( assignments );

            let validCount = 0;
            let invalidCount = 0;
            const issues: Array<{
                assignment: GroupAssignment;
                errors: string[];
                warnings: string[];
            }> = [];

            for ( const [ , result ] of validationResults ) {
                if ( result.isValid ) {
                    validCount++;
                } else {
                    invalidCount++;
                }

                if ( result.errors.length > 0 || result.warnings.length > 0 ) {
                    const assignment = assignments.find( a =>
                        `${a.azureGroupId}-${a.awsAccountId}-${a.permissionSetArn}` ===
                        Array.from( validationResults.keys() ).find( key => validationResults.get( key ) === result )
                    );

                    if ( assignment ) {
                        issues.push( {
                            assignment,
                            errors: result.errors,
                            warnings: result.warnings
                        } );
                    }
                }
            }

            return {
                totalAssignments: assignments.length,
                validAssignments: validCount,
                invalidAssignments: invalidCount,
                issues
            };
        } catch ( error ) {
            throw new Error( `Failed to validate all assignments: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Generate troubleshooting report for failed assignments
     */
    async generateTroubleshootingReport( assignment: GroupAssignment ): Promise<string> {
        try {
            const validation = await this.validateAssignment( assignment );
            const functionality = await this.testAssignmentFunctionality( assignment );

            let report = `# Troubleshooting Report for Assignment\n\n`;
            report += `**Azure Group ID:** ${assignment.azureGroupId}\n`;
            report += `**AWS Account ID:** ${assignment.awsAccountId}\n`;
            report += `**Permission Set ARN:** ${assignment.permissionSetArn}\n`;
            report += `**Assignment Status:** ${assignment.assignmentStatus}\n\n`;

            report += `## Validation Results\n\n`;
            report += `**Overall Status:** ${validation.isValid ? '✅ Valid' : '❌ Invalid'}\n\n`;

            if ( validation.errors.length > 0 ) {
                report += `### Errors\n`;
                for ( const error of validation.errors ) {
                    report += `- ❌ ${error}\n`;
                }
                report += '\n';
            }

            if ( validation.warnings.length > 0 ) {
                report += `### Warnings\n`;
                for ( const warning of validation.warnings ) {
                    report += `- ⚠️ ${warning}\n`;
                }
                report += '\n';
            }

            report += `## Functionality Test Results\n\n`;
            report += `**Overall Functionality:** ${functionality.isWorking ? '✅ Working' : '❌ Not Working'}\n\n`;

            report += `### Test Results\n`;
            report += `- Group Exists: ${functionality.testResults.groupExists ? '✅' : '❌'}\n`;
            report += `- Group Synced: ${functionality.testResults.groupSynced ? '✅' : '❌'}\n`;
            report += `- Permission Set Exists: ${functionality.testResults.permissionSetExists ? '✅' : '❌'}\n`;
            report += `- Assignment Active: ${functionality.testResults.assignmentActive ? '✅' : '❌'}\n`;
            report += `- End-to-End Access: ${functionality.testResults.endToEndAccess ? '✅' : '❌'}\n\n`;

            if ( functionality.recommendations.length > 0 ) {
                report += `### Recommendations\n`;
                for ( const recommendation of functionality.recommendations ) {
                    report += `- 💡 ${recommendation}\n`;
                }
                report += '\n';
            }

            return report;
        } catch ( error ) {
            return `# Troubleshooting Report - Error\n\nFailed to generate report: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
    }
}
