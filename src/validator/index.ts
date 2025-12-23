// Assignment Validator - Comprehensive validation logic for AWS-Azure SSO assignments
import { AWSClient } from '../clients/aws-client';
import { AzureClient } from '../clients/azure-client';
import { GroupAssignment } from '../types';

export interface ValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
    details: {
        azureGroup?: {
            exists: boolean;
            isActive: boolean;
            memberCount: number;
            isSecurityGroup: boolean;
        };
        synchronization?: {
            isSynced: boolean;
            awsGroupId?: string;
            lastSyncTime?: Date;
        };
        permissionSet?: {
            exists: boolean;
            isProvisioned: boolean;
            hasValidPolicies: boolean;
        };
        assignment?: {
            exists: boolean;
            status: string;
            isActive: boolean;
        };
        functionality?: {
            canAuthenticate: boolean;
            hasExpectedPermissions: boolean;
        };
    };
}

export interface AssignmentTestResult {
    success: boolean;
    testResults: {
        groupSynchronization: boolean;
        permissionInheritance: boolean;
        assignmentFunctionality: boolean;
    };
    errors: string[];
    details: Record<string, unknown>;
}

export class AssignmentValidator {
    private azureClient: AzureClient;
    private awsClient: AWSClient;

    constructor( azureClient: AzureClient, awsClient: AWSClient ) {
        this.azureClient = azureClient;
        this.awsClient = awsClient;
    }

    /**
     * Comprehensive assignment validation
     * Implements Requirements 4.1, 4.3, 4.4: Check group synchronization, validate permissions, test functionality
     */
    async validateAssignment( assignment: GroupAssignment ): Promise<ValidationResult> {
        const result: ValidationResult = {
            isValid: false,
            errors: [],
            warnings: [],
            details: {}
        };

        try {
            // Step 1: Validate Azure group
            const azureValidation = await this.validateAzureGroup( assignment.azureGroupId );
            result.details.azureGroup = azureValidation;

            if ( !azureValidation.exists ) {
                result.errors.push( `Azure group ${assignment.azureGroupId} does not exist` );
            }
            if ( !azureValidation.isActive ) {
                result.errors.push( `Azure group ${assignment.azureGroupId} is not active` );
            }
            if ( !azureValidation.isSecurityGroup ) {
                result.errors.push( `Azure group ${assignment.azureGroupId} is not a security group` );
            }
            if ( azureValidation.memberCount === 0 ) {
                result.warnings.push( `Azure group ${assignment.azureGroupId} has no members` );
            }

            // Step 2: Check synchronization status
            const syncValidation = await this.validateSynchronization( assignment.azureGroupId );
            result.details.synchronization = syncValidation;

            if ( !syncValidation.isSynced ) {
                result.errors.push( `Azure group ${assignment.azureGroupId} is not synchronized to AWS Identity Center` );
            }

            // Step 3: Validate permission set
            const permissionSetValidation = await this.validatePermissionSet( assignment.permissionSetArn );
            result.details.permissionSet = permissionSetValidation;

            if ( !permissionSetValidation.exists ) {
                result.errors.push( `Permission set ${assignment.permissionSetArn} does not exist` );
            }
            if ( !permissionSetValidation.isProvisioned ) {
                result.errors.push( `Permission set ${assignment.permissionSetArn} is not provisioned` );
            }
            if ( !permissionSetValidation.hasValidPolicies ) {
                result.warnings.push( `Permission set ${assignment.permissionSetArn} may have invalid or missing policies` );
            }

            // Step 4: Validate assignment exists and is active
            const assignmentValidation = await this.validateAssignmentStatus( assignment );
            result.details.assignment = assignmentValidation;

            if ( !assignmentValidation.exists ) {
                result.errors.push( `Assignment does not exist for group ${assignment.azureGroupId} to permission set ${assignment.permissionSetArn} in account ${assignment.awsAccountId}` );
            }
            if ( !assignmentValidation.isActive ) {
                result.errors.push( `Assignment is not active (status: ${assignmentValidation.status})` );
            }

            // Step 5: Test functionality (if all prerequisites are met)
            if ( result.errors.length === 0 ) {
                const functionalityTest = await this.testAssignmentFunctionality( assignment );
                result.details.functionality = {
                    canAuthenticate: functionalityTest.testResults.groupSynchronization,
                    hasExpectedPermissions: functionalityTest.testResults.permissionInheritance
                };

                if ( !functionalityTest.success ) {
                    result.errors.push( `Functionality test failed: ${functionalityTest.errors.join( ', ' )}` );
                }
            }

            // Determine overall validity
            result.isValid = result.errors.length === 0;

        } catch ( error ) {
            result.errors.push( `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Test assignment functionality
     * Implements Requirements 4.1, 4.3, 4.4: Test that group members can authenticate and have proper access
     */
    async testAssignmentFunctionality( assignment: GroupAssignment ): Promise<AssignmentTestResult> {
        const result: AssignmentTestResult = {
            success: false,
            testResults: {
                groupSynchronization: false,
                permissionInheritance: false,
                assignmentFunctionality: false
            },
            errors: [],
            details: {}
        };

        try {
            // Test 1: Group synchronization
            const syncStatus = await this.awsClient.checkGroupSynchronizationStatus( assignment.azureGroupId );
            result.testResults.groupSynchronization = syncStatus.isSynced;
            result.details.synchronization = syncStatus;

            if ( !syncStatus.isSynced ) {
                result.errors.push( 'Group is not synchronized to AWS Identity Center' );
            }

            // Test 2: Permission inheritance
            if ( syncStatus.isSynced && syncStatus.awsGroupId ) {
                const permissionTest = await this.testPermissionInheritance(
                    syncStatus.awsGroupId,
                    assignment.permissionSetArn,
                    assignment.awsAccountId
                );
                result.testResults.permissionInheritance = permissionTest.success;
                result.details.permissionInheritance = permissionTest;

                if ( !permissionTest.success ) {
                    result.errors.push( `Permission inheritance test failed: ${permissionTest.error}` );
                }
            }

            // Test 3: Assignment functionality
            const assignmentTest = await this.testAssignmentActive( assignment );
            result.testResults.assignmentFunctionality = assignmentTest.isActive;
            result.details.assignmentStatus = assignmentTest;

            if ( !assignmentTest.isActive ) {
                result.errors.push( `Assignment is not active: ${assignmentTest.status}` );
            }

            // Overall success
            result.success = result.testResults.groupSynchronization &&
                result.testResults.permissionInheritance &&
                result.testResults.assignmentFunctionality;

        } catch ( error ) {
            result.errors.push( `Functionality test failed: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Validate Azure group details
     */
    private async validateAzureGroup( azureGroupId: string ): Promise<{
        exists: boolean;
        isActive: boolean;
        memberCount: number;
        isSecurityGroup: boolean;
    }> {
        try {
            const validation = await this.azureClient.validateGroupDetailed( azureGroupId );

            return {
                exists: validation.exists,
                isActive: validation.isActive,
                memberCount: validation.memberCount,
                isSecurityGroup: validation.isSecurityGroup
            };
        } catch ( error ) {
            return {
                exists: false,
                isActive: false,
                memberCount: 0,
                isSecurityGroup: false
            };
        }
    }

    /**
     * Validate synchronization status
     */
    private async validateSynchronization( azureGroupId: string ): Promise<{
        isSynced: boolean;
        awsGroupId?: string;
        lastSyncTime?: Date;
    }> {
        try {
            return await this.awsClient.checkGroupSynchronizationStatus( azureGroupId );
        } catch ( error ) {
            return {
                isSynced: false
            };
        }
    }

    /**
     * Validate permission set
     */
    private async validatePermissionSet( permissionSetArn: string ): Promise<{
        exists: boolean;
        isProvisioned: boolean;
        hasValidPolicies: boolean;
    }> {
        try {
            const permissionSets = await this.awsClient.listPermissionSets();
            const permissionSet = permissionSets.find( ps => ps.arn === permissionSetArn );

            if ( !permissionSet ) {
                return {
                    exists: false,
                    isProvisioned: false,
                    hasValidPolicies: false
                };
            }

            // Check if permission set has policies
            const hasValidPolicies = Boolean( ( permissionSet.managedPolicies && permissionSet.managedPolicies.length > 0 ) ||
                ( permissionSet.inlinePolicy && permissionSet.inlinePolicy.trim().length > 0 ) );

            return {
                exists: true,
                isProvisioned: true, // If it exists in the list, it's provisioned
                hasValidPolicies
            };
        } catch ( error ) {
            return {
                exists: false,
                isProvisioned: false,
                hasValidPolicies: false
            };
        }
    }

    /**
     * Validate assignment status
     */
    private async validateAssignmentStatus( assignment: GroupAssignment ): Promise<{
        exists: boolean;
        status: string;
        isActive: boolean;
    }> {
        try {
            const assignments = await this.awsClient.listAccountAssignments();
            const existingAssignment = assignments.find( a =>
                a.principalId === assignment.azureGroupId &&
                a.permissionSetArn === assignment.permissionSetArn &&
                a.accountId === assignment.awsAccountId
            );

            if ( !existingAssignment ) {
                return {
                    exists: false,
                    status: 'NOT_FOUND',
                    isActive: false
                };
            }

            return {
                exists: true,
                status: existingAssignment.status,
                isActive: existingAssignment.status === 'PROVISIONED'
            };
        } catch ( error ) {
            return {
                exists: false,
                status: 'ERROR',
                isActive: false
            };
        }
    }

    /**
     * Test permission inheritance
     */
    private async testPermissionInheritance(
        awsGroupId: string,
        permissionSetArn: string,
        accountId: string
    ): Promise<{ success: boolean; error?: string }> {
        try {
            // Get group details to verify it exists in AWS
            const groupDetails = await this.awsClient.getGroupDetails( awsGroupId );

            if ( !groupDetails.displayName ) {
                return {
                    success: false,
                    error: 'AWS group not found or has no display name'
                };
            }

            // Check if the group has the expected assignment
            const assignments = await this.awsClient.getAccountAssignmentsForAccount( accountId );
            const groupAssignment = assignments.find( a =>
                a.principalId === awsGroupId &&
                a.permissionSetArn === permissionSetArn
            );

            if ( !groupAssignment ) {
                return {
                    success: false,
                    error: 'Group assignment not found in AWS'
                };
            }

            return { success: true };
        } catch ( error ) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    /**
     * Test if assignment is active
     */
    private async testAssignmentActive( assignment: GroupAssignment ): Promise<{
        isActive: boolean;
        status: string;
    }> {
        try {
            const assignments = await this.awsClient.listAccountAssignments();
            const existingAssignment = assignments.find( a =>
                a.principalId === assignment.azureGroupId &&
                a.permissionSetArn === assignment.permissionSetArn &&
                a.accountId === assignment.awsAccountId
            );

            if ( !existingAssignment ) {
                return {
                    isActive: false,
                    status: 'NOT_FOUND'
                };
            }

            return {
                isActive: existingAssignment.status === 'PROVISIONED',
                status: existingAssignment.status
            };
        } catch ( error ) {
            return {
                isActive: false,
                status: 'ERROR'
            };
        }
    }

    /**
     * Batch validate multiple assignments
     */
    async validateAssignments( assignments: GroupAssignment[] ): Promise<Map<string, ValidationResult>> {
        const results = new Map<string, ValidationResult>();

        // Process assignments in parallel for better performance
        const validationPromises = assignments.map( async ( assignment ) => {
            const key = `${assignment.azureGroupId}-${assignment.awsAccountId}-${assignment.permissionSetArn}`;
            try {
                const validation = await this.validateAssignment( assignment );
                return { key, validation };
            } catch ( error ) {
                return {
                    key,
                    validation: {
                        isValid: false,
                        errors: [ error instanceof Error ? error.message : 'Unknown error' ],
                        warnings: [],
                        details: {}
                    } as ValidationResult
                };
            }
        } );

        const validationResults = await Promise.all( validationPromises );

        for ( const { key, validation } of validationResults ) {
            results.set( key, validation );
        }

        return results;
    }

    /**
     * Get validation summary for multiple assignments
     */
    async getValidationSummary( assignments: GroupAssignment[] ): Promise<{
        totalAssignments: number;
        validAssignments: number;
        invalidAssignments: number;
        warningsCount: number;
        commonIssues: string[];
        details: Map<string, ValidationResult>;
    }> {
        const validationResults = await this.validateAssignments( assignments );

        let validCount = 0;
        let invalidCount = 0;
        let totalWarnings = 0;
        const issueFrequency = new Map<string, number>();

        for ( const result of validationResults.values() ) {
            if ( result.isValid ) {
                validCount++;
            } else {
                invalidCount++;
            }

            totalWarnings += result.warnings.length;

            // Track common issues
            for ( const error of result.errors ) {
                const count = issueFrequency.get( error ) || 0;
                issueFrequency.set( error, count + 1 );
            }
        }

        // Get most common issues (appearing in more than 1 assignment)
        const commonIssues = Array.from( issueFrequency.entries() )
            .filter( ( [ , count ] ) => count > 1 )
            .sort( ( [ , a ], [ , b ] ) => b - a )
            .map( ( [ issue ] ) => issue );

        return {
            totalAssignments: assignments.length,
            validAssignments: validCount,
            invalidAssignments: invalidCount,
            warningsCount: totalWarnings,
            commonIssues,
            details: validationResults
        };
    }
}
