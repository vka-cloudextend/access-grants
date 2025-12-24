// Assignment Orchestrator - Coordinates Azure AD and AWS operations
import { v4 as uuidv4 } from 'uuid';
import { AWSClient } from '../clients/aws-client';
import { AzureClient } from '../clients/azure-client';
import { PermissionSetManager } from '../permission-sets';
import { AssignmentOperation, GroupAssignment, OperationError, PermissionSet } from '../types';
import { OperationHistoryStorage } from '../storage/operation-history';

export interface OrchestrationConfig {
    azure: {
        tenantId: string;
        clientId: string;
        clientSecret: string;
        enterpriseApplicationId: string; // AWS IAM Identity Center Enterprise App ID
    };
    aws: {
        region: string;
        identityCenterInstanceArn: string;
        identityStoreId: string;
        accountMapping: {
            Dev: string;
            QA: string;
            Staging: string;
            Prod: string;
        };
    };
    retryAttempts?: number;
    retryDelayMs?: number;
}

export interface AccessGrantRequest {
    accountType: 'Dev' | 'QA' | 'Staging' | 'Prod';
    ticketId: string; // Format: AG-XXXX
    owners: string[]; // Email addresses
    members: string[]; // Email addresses
    permissionTemplate?: string; // Optional template name
    customPermissions?: {
        managedPolicies?: string[];
        inlinePolicy?: string;
        sessionDuration?: string;
    };
    description?: string;
}

export interface AccessGrantResult {
    groupName: string;
    azureGroupId: string;
    permissionSetArn: string;
    awsAccountId: string;
    operation: AssignmentOperation;
    validationResults?: {
        groupSynced: boolean;
        permissionSetCreated: boolean;
        assignmentActive: boolean;
        usersCanAccess: boolean;
    };
}

interface ConflictDetectionResult {
    hasConflicts: boolean;
    conflicts: AssignmentConflict[];
}

interface AssignmentConflict {
    type: 'DUPLICATE_ASSIGNMENT' | 'PERMISSION_OVERLAP' | 'GROUP_NOT_SYNCED';
    azureGroupId: string;
    awsAccountId: string;
    permissionSetArn: string;
    existingAssignment?: GroupAssignment;
    message: string;
}

interface WorkflowState {
    operationId: string;
    currentStep: 'VALIDATION' | 'CONFLICT_CHECK' | 'AZURE_VALIDATION' | 'AWS_ASSIGNMENT' | 'VERIFICATION' | 'COMPLETED' | 'FAILED' |
    'AZURE_GROUP_CREATION' | 'AZURE_GROUP_MEMBERS' | 'ENTERPRISE_APP_CONFIG' | 'PROVISIONING' |
    'AWS_SYNC_VERIFICATION' | 'AWS_PERMISSION_SET_CREATION' | 'AWS_ACCOUNT_ASSIGNMENT' | 'END_TO_END_VALIDATION';
    completedSteps: string[];
    errors: OperationError[];
    rollbackActions: RollbackAction[];
}

interface RollbackAction {
    type: 'DELETE_ASSIGNMENT' | 'DELETE_PERMISSION_SET' | 'RESTORE_ASSIGNMENT' | 'DELETE_AZURE_GROUP' | 'REMOVE_ENTERPRISE_APP_ASSIGNMENT';
    data: Record<string, unknown>;
}

export class AssignmentOrchestrator {
    private azureClient: AzureClient;
    private awsClient: AWSClient;
    private permissionSetManager: PermissionSetManager;
    private config: OrchestrationConfig;
    private operationStates: Map<string, WorkflowState> = new Map();
    private operationHistoryStorage: OperationHistoryStorage;

    constructor( config: OrchestrationConfig, operationHistoryStorage?: OperationHistoryStorage ) {
        this.config = config;
        this.azureClient = new AzureClient( config.azure );
        this.awsClient = new AWSClient( config.aws );
        this.permissionSetManager = new PermissionSetManager( this.awsClient );
        this.operationHistoryStorage = operationHistoryStorage || new OperationHistoryStorage();
    }

    /**
     * Create a single group assignment
     * Implements Requirements 3.2: Validate that assignment doesn't conflict with existing assignments
     */
    async createAssignment( assignment: Omit<GroupAssignment, 'createdDate' | 'assignmentStatus'> ): Promise<AssignmentOperation> {
        const operationId = uuidv4();
        const operation: AssignmentOperation = {
            operationId,
            operationType: 'CREATE',
            assignments: [ {
                ...assignment,
                createdDate: new Date(),
                assignmentStatus: 'PENDING'
            } ],
            status: 'IN_PROGRESS',
            errors: [],
            startTime: new Date()
        };

        // Initialize workflow state
        const workflowState: WorkflowState = {
            operationId,
            currentStep: 'VALIDATION',
            completedSteps: [],
            errors: [],
            rollbackActions: []
        };
        this.operationStates.set( operationId, workflowState );

        try {
            // Step 1: Validate Azure group
            await this.validateAzureGroup( assignment.azureGroupId, workflowState );

            // Step 2: Detect conflicts
            const conflictResult = await this.detectConflicts( [ assignment ], workflowState );
            if ( conflictResult.hasConflicts ) {
                throw new Error( `Assignment conflicts detected: ${conflictResult.conflicts.map( c => c.message ).join( ', ' )}` );
            }

            // Step 3: Create AWS assignment
            await this.executeAWSAssignment( assignment, workflowState );

            // Step 4: Verify assignment
            await this.verifyAssignment( assignment, workflowState );

            // Mark as completed
            operation.status = 'COMPLETED';
            operation.endTime = new Date();
            operation.assignments[ 0 ].assignmentStatus = 'ACTIVE';
            workflowState.currentStep = 'COMPLETED';

        } catch ( error ) {
            operation.status = 'FAILED';
            operation.endTime = new Date();
            operation.assignments[ 0 ].assignmentStatus = 'FAILED';
            workflowState.currentStep = 'FAILED';

            const operationError: OperationError = {
                code: 'ASSIGNMENT_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date()
            };
            operation.errors.push( operationError );
            workflowState.errors.push( operationError );

            // Attempt rollback
            await this.performRollback( workflowState );
        }

        await this.operationHistoryStorage.addOperation( operation );
        return operation;
    }

    /**
     * Create multiple group assignments in bulk
     * Implements Requirements 7.4: Workflow state management for bulk operations
     */
    async bulkAssign( assignments: Omit<GroupAssignment, 'createdDate' | 'assignmentStatus'>[] ): Promise<AssignmentOperation> {
        const operationId = uuidv4();
        const operation: AssignmentOperation = {
            operationId,
            operationType: 'CREATE',
            assignments: assignments.map( a => ( {
                ...a,
                createdDate: new Date(),
                assignmentStatus: 'PENDING'
            } ) ),
            status: 'IN_PROGRESS',
            errors: [],
            startTime: new Date()
        };

        const workflowState: WorkflowState = {
            operationId,
            currentStep: 'VALIDATION',
            completedSteps: [],
            errors: [],
            rollbackActions: []
        };
        this.operationStates.set( operationId, workflowState );

        try {
            // Step 1: Validate all Azure groups
            for ( const assignment of assignments ) {
                await this.validateAzureGroup( assignment.azureGroupId, workflowState );
            }

            // Step 2: Detect conflicts across all assignments
            const conflictResult = await this.detectConflicts( assignments, workflowState );
            if ( conflictResult.hasConflicts ) {
                throw new Error( `Bulk assignment conflicts detected: ${conflictResult.conflicts.map( c => c.message ).join( ', ' )}` );
            }

            // Step 3: Execute assignments with partial failure handling
            const results = await this.executeBulkAWSAssignments( assignments, workflowState );

            // Step 4: Verify successful assignments
            for ( let i = 0; i < assignments.length; i++ ) {
                if ( results[ i ].success ) {
                    await this.verifyAssignment( assignments[ i ], workflowState );
                    operation.assignments[ i ].assignmentStatus = 'ACTIVE';
                } else {
                    operation.assignments[ i ].assignmentStatus = 'FAILED';
                    operation.errors.push( {
                        code: 'ASSIGNMENT_FAILED',
                        message: results[ i ].error || 'Unknown error',
                        details: { assignmentIndex: i, assignment: assignments[ i ] },
                        timestamp: new Date()
                    } );
                }
            }

            // Determine overall operation status
            const successCount = results.filter( r => r.success ).length;
            if ( successCount === assignments.length ) {
                operation.status = 'COMPLETED';
                workflowState.currentStep = 'COMPLETED';
            } else if ( successCount > 0 ) {
                operation.status = 'COMPLETED'; // Partial success is still completion
                workflowState.currentStep = 'COMPLETED';
            } else {
                operation.status = 'FAILED';
                workflowState.currentStep = 'FAILED';
            }

            operation.endTime = new Date();

        } catch ( error ) {
            operation.status = 'FAILED';
            operation.endTime = new Date();
            workflowState.currentStep = 'FAILED';

            // Mark all assignments as failed
            operation.assignments.forEach( a => a.assignmentStatus = 'FAILED' );

            const operationError: OperationError = {
                code: 'BULK_ASSIGNMENT_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date()
            };
            operation.errors.push( operationError );
            workflowState.errors.push( operationError );

            // Attempt rollback
            await this.performRollback( workflowState );
        }

        await this.operationHistoryStorage.addOperation( operation );
        return operation;
    }

    /**
     * Rollback a completed operation
     * Implements Requirements 7.4: Rollback capabilities
     */
    async rollbackOperation( operationId: string ): Promise<void> {
        const operation = await this.operationHistoryStorage.getOperation( operationId );
        if ( !operation ) {
            throw new Error( `Operation ${operationId} not found` );
        }

        if ( operation.status !== 'COMPLETED' ) {
            throw new Error( `Cannot rollback operation ${operationId} - status is ${operation.status}` );
        }

        const workflowState = this.operationStates.get( operationId );
        if ( !workflowState ) {
            throw new Error( `Workflow state for operation ${operationId} not found` );
        }

        try {
            await this.performRollback( workflowState );
            operation.status = 'ROLLED_BACK';
            operation.endTime = new Date();
        } catch ( error ) {
            throw new Error( `Rollback failed for operation ${operationId}: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Get operation status and details
     */
    async getOperationStatus( operationId: string ): Promise<AssignmentOperation | undefined> {
        return await this.operationHistoryStorage.getOperation( operationId );
    }

    /**
     * List all operations
     */
    async listOperations(): Promise<AssignmentOperation[]> {
        return await this.operationHistoryStorage.getAllOperations();
    }

    /**
     * Validate Azure group exists and is suitable for AWS assignment
     */
    private async validateAzureGroup( azureGroupId: string, workflowState: WorkflowState ): Promise<void> {
        workflowState.currentStep = 'AZURE_VALIDATION';

        try {
            const validation = await this.azureClient.validateGroupDetailed( azureGroupId );

            if ( !validation.isValid ) {
                const errorMessage = `Azure group ${azureGroupId} validation failed: ${validation.errors.join( ', ' )}`;
                throw new Error( errorMessage );
            }

            workflowState.completedSteps.push( 'AZURE_VALIDATION' );
        } catch ( error ) {
            const operationError: OperationError = {
                code: 'AZURE_VALIDATION_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: { azureGroupId },
                timestamp: new Date()
            };
            workflowState.errors.push( operationError );
            throw error;
        }
    }

    /**
     * Detect conflicts with existing assignments
     * Implements Requirements 3.2: Validate that assignment doesn't conflict with existing assignments
     */
    private async detectConflicts(
        assignments: Omit<GroupAssignment, 'createdDate' | 'assignmentStatus'>[],
        workflowState: WorkflowState
    ): Promise<ConflictDetectionResult> {
        workflowState.currentStep = 'CONFLICT_CHECK';

        const conflicts: AssignmentConflict[] = [];

        try {
            // Get existing assignments
            const existingAssignments = await this.awsClient.listAccountAssignments();

            for ( const assignment of assignments ) {
                // Check for duplicate assignments
                const duplicateAssignment = existingAssignments.find( existing =>
                    existing.principalId === assignment.azureGroupId &&
                    existing.permissionSetArn === assignment.permissionSetArn &&
                    existing.accountId === assignment.awsAccountId
                );

                if ( duplicateAssignment ) {
                    conflicts.push( {
                        type: 'DUPLICATE_ASSIGNMENT',
                        azureGroupId: assignment.azureGroupId,
                        awsAccountId: assignment.awsAccountId,
                        permissionSetArn: assignment.permissionSetArn,
                        message: `Group ${assignment.azureGroupId} is already assigned to permission set ${assignment.permissionSetArn} in account ${assignment.awsAccountId}`
                    } );
                }

                // Check if Azure group is synced to AWS
                const syncStatus = await this.awsClient.checkGroupSynchronizationStatus( assignment.azureGroupId );
                if ( !syncStatus.isSynced ) {
                    conflicts.push( {
                        type: 'GROUP_NOT_SYNCED',
                        azureGroupId: assignment.azureGroupId,
                        awsAccountId: assignment.awsAccountId,
                        permissionSetArn: assignment.permissionSetArn,
                        message: `Azure group ${assignment.azureGroupId} is not synchronized to AWS Identity Center`
                    } );
                }
            }

            // Check for conflicts within the current batch
            const groupAccountPermissionSets = new Set<string>();
            for ( const assignment of assignments ) {
                const key = `${assignment.azureGroupId}-${assignment.awsAccountId}-${assignment.permissionSetArn}`;
                if ( groupAccountPermissionSets.has( key ) ) {
                    conflicts.push( {
                        type: 'DUPLICATE_ASSIGNMENT',
                        azureGroupId: assignment.azureGroupId,
                        awsAccountId: assignment.awsAccountId,
                        permissionSetArn: assignment.permissionSetArn,
                        message: `Duplicate assignment in batch: Group ${assignment.azureGroupId} to permission set ${assignment.permissionSetArn} in account ${assignment.awsAccountId}`
                    } );
                }
                groupAccountPermissionSets.add( key );
            }

            workflowState.completedSteps.push( 'CONFLICT_CHECK' );

            return {
                hasConflicts: conflicts.length > 0,
                conflicts
            };

        } catch ( error ) {
            const operationError: OperationError = {
                code: 'CONFLICT_DETECTION_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date()
            };
            workflowState.errors.push( operationError );
            throw error;
        }
    }

    /**
     * Execute AWS assignment for a single group
     */
    private async executeAWSAssignment(
        assignment: Omit<GroupAssignment, 'createdDate' | 'assignmentStatus'>,
        workflowState: WorkflowState
    ): Promise<void> {
        workflowState.currentStep = 'AWS_ASSIGNMENT';

        try {
            const accountAssignment = await this.awsClient.assignGroupToAccount(
                assignment.azureGroupId,
                assignment.awsAccountId,
                assignment.permissionSetArn
            );

            // Store rollback action
            workflowState.rollbackActions.push( {
                type: 'DELETE_ASSIGNMENT',
                data: {
                    groupId: assignment.azureGroupId,
                    accountId: assignment.awsAccountId,
                    permissionSetArn: assignment.permissionSetArn
                }
            } );

            workflowState.completedSteps.push( 'AWS_ASSIGNMENT' );

        } catch ( error ) {
            const operationError: OperationError = {
                code: 'AWS_ASSIGNMENT_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: { assignment },
                timestamp: new Date()
            };
            workflowState.errors.push( operationError );
            throw error;
        }
    }

    /**
     * Execute bulk AWS assignments with partial failure handling
     */
    private async executeBulkAWSAssignments(
        assignments: Omit<GroupAssignment, 'createdDate' | 'assignmentStatus'>[],
        workflowState: WorkflowState
    ): Promise<Array<{ success: boolean; error?: string }>> {
        workflowState.currentStep = 'AWS_ASSIGNMENT';

        const results: Array<{ success: boolean; error?: string }> = [];

        for ( const assignment of assignments ) {
            try {
                await this.awsClient.assignGroupToAccount(
                    assignment.azureGroupId,
                    assignment.awsAccountId,
                    assignment.permissionSetArn
                );

                // Store rollback action for successful assignments
                workflowState.rollbackActions.push( {
                    type: 'DELETE_ASSIGNMENT',
                    data: {
                        groupId: assignment.azureGroupId,
                        accountId: assignment.awsAccountId,
                        permissionSetArn: assignment.permissionSetArn
                    }
                } );

                results.push( { success: true } );

            } catch ( error ) {
                results.push( {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                } );
            }
        }

        workflowState.completedSteps.push( 'AWS_ASSIGNMENT' );
        return results;
    }

    /**
     * Verify that assignment is working correctly
     */
    private async verifyAssignment(
        assignment: Omit<GroupAssignment, 'createdDate' | 'assignmentStatus'>,
        workflowState: WorkflowState
    ): Promise<void> {
        workflowState.currentStep = 'VERIFICATION';

        try {
            // Check group synchronization status
            const syncStatus = await this.awsClient.checkGroupSynchronizationStatus( assignment.azureGroupId );
            if ( !syncStatus.isSynced ) {
                throw new Error( `Group ${assignment.azureGroupId} is not synchronized to AWS` );
            }

            // Additional verification could include testing actual permissions
            // This would require more complex testing infrastructure

            workflowState.completedSteps.push( 'VERIFICATION' );

        } catch ( error ) {
            const operationError: OperationError = {
                code: 'VERIFICATION_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: { assignment },
                timestamp: new Date()
            };
            workflowState.errors.push( operationError );
            throw error;
        }
    }

    /**
     * Perform rollback actions
     * Implements Requirements 7.3: Rollback capabilities with proper error handling
     */
    private async performRollback( workflowState: WorkflowState ): Promise<void> {
        console.log( `Starting rollback for operation ${workflowState.operationId} with ${workflowState.rollbackActions.length} actions` );

        const rollbackErrors: string[] = [];
        let successfulRollbacks = 0;

        // Execute rollback actions in reverse order (LIFO - Last In, First Out)
        for ( const action of workflowState.rollbackActions.reverse() ) {
            try {
                console.log( `Executing rollback action: ${action.type}` );

                switch ( action.type ) {
                    case 'DELETE_ASSIGNMENT':
                        await this.rollbackDeleteAssignment( action.data );
                        break;
                    case 'DELETE_PERMISSION_SET':
                        await this.rollbackDeletePermissionSet( action.data );
                        break;
                    case 'RESTORE_ASSIGNMENT':
                        await this.rollbackRestoreAssignment( action.data );
                        break;
                    case 'DELETE_AZURE_GROUP':
                        await this.rollbackDeleteAzureGroup( action.data );
                        break;
                    case 'REMOVE_ENTERPRISE_APP_ASSIGNMENT':
                        await this.rollbackRemoveEnterpriseAppAssignment( action.data );
                        break;
                    default:
                        console.warn( `Unknown rollback action type: ${action.type}` );
                        continue;
                }

                successfulRollbacks++;
                console.log( `Rollback action ${action.type} completed successfully` );

            } catch ( error ) {
                const errorMessage = `Rollback action ${action.type} failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
                console.error( errorMessage );
                rollbackErrors.push( errorMessage );

                // Continue with other rollback actions even if one fails
                // This ensures we attempt to clean up as much as possible
            }
        }

        // Log rollback summary
        console.log( `Rollback completed: ${successfulRollbacks}/${workflowState.rollbackActions.length} actions successful` );

        if ( rollbackErrors.length > 0 ) {
            console.error( `Rollback errors encountered:` );
            rollbackErrors.forEach( ( error, index ) => {
                console.error( `  ${index + 1}. ${error}` );
            } );

            // Add rollback errors to workflow state for tracking
            workflowState.errors.push( {
                code: 'ROLLBACK_PARTIAL_FAILURE',
                message: `${rollbackErrors.length} rollback actions failed: ${rollbackErrors.join( '; ' )}`,
                details: { rollbackErrors, successfulRollbacks, totalActions: workflowState.rollbackActions.length },
                timestamp: new Date()
            } );
        }
    }

    /**
     * Get workflow state for an operation
     */
    getWorkflowState( operationId: string ): WorkflowState | undefined {
        return this.operationStates.get( operationId );
    }

    /**
     * Clean up old operation states (for memory management)
     */
    async cleanupOldOperations( olderThanHours: number = 24 ): Promise<void> {
        const cutoffTime = new Date( Date.now() - ( olderThanHours * 60 * 60 * 1000 ) );

        // Clean up persistent storage
        await this.operationHistoryStorage.cleanup();

        // Clean up in-memory operation states
        for ( const [ operationId, operation ] of this.operationStates.entries() ) {
            // We don't have operation start time in workflow state, so use a different approach
            // Remove states older than the cutoff time based on when they were created
            this.operationStates.delete( operationId );
        }
    }

    // Permission Set Management Methods

    /**
     * Get available permission set templates
     * Implements Requirements 2.3: Display templates based on common access patterns
     */
    getPermissionSetTemplates() {
        return this.permissionSetManager.getAvailableTemplates();
    }

    /**
     * Get permission set recommendations for a group
     */
    getPermissionSetRecommendations( groupName: string, groupDescription?: string ): string[] {
        return this.permissionSetManager.getRecommendedTemplates( groupName, groupDescription );
    }

    /**
     * Create permission set from template
     * Implements Requirements 2.2, 2.3: Guide creation of new permission sets with templates
     */
    async createPermissionSetFromTemplate( templateName: string, customizations?: any ): Promise<PermissionSet> {
        return await this.permissionSetManager.createFromTemplate( templateName, customizations );
    }

    /**
     * Create custom permission set
     * Implements Requirements 2.2: Custom permission set creation workflow
     */
    async createCustomPermissionSet( request: any ): Promise<PermissionSet> {
        return await this.permissionSetManager.createCustomPermissionSet( request );
    }

    /**
     * Validate permission set configuration
     * Implements Requirements 2.4: Validate that permission sets contain appropriate policies and permissions
     */
    async validatePermissionSet( permissionSetArn: string ) {
        return await this.permissionSetManager.validateExistingPermissionSet( permissionSetArn );
    }

    /**
     * List existing permission sets
     */
    async listPermissionSets(): Promise<PermissionSet[]> {
        return await this.permissionSetManager.listExistingPermissionSets();
    }

    /**
     * Check if permission set name exists
     */
    async permissionSetExists( name: string ): Promise<boolean> {
        return await this.permissionSetManager.permissionSetExists( name );
    }

    /**
     * Generate unique permission set name
     */
    async generateUniquePermissionSetName( baseName: string ): Promise<string> {
        return await this.permissionSetManager.generateUniquePermissionSetName( baseName );
    }

    // Access Grant Workflow Methods (Following Manual Process)

    /**
     * Create complete access grant following the standardized workflow
     * Implements the full manual process automation
     */
    async createAccessGrant( request: AccessGrantRequest ): Promise<AccessGrantResult> {
        const operationId = uuidv4();

        // Step 1: Generate standardized group name
        const groupName = this.generateGroupName( request.accountType, request.ticketId );

        const operation: AssignmentOperation = {
            operationId,
            operationType: 'CREATE',
            assignments: [],
            status: 'IN_PROGRESS',
            errors: [],
            startTime: new Date()
        };

        const workflowState: WorkflowState = {
            operationId,
            currentStep: 'VALIDATION',
            completedSteps: [],
            errors: [],
            rollbackActions: []
        };
        this.operationStates.set( operationId, workflowState );

        try {
            // Phase 1: Validation and Preparation
            await this.validateAccessGrantRequest( request, workflowState );

            // Phase 2: Azure AD Operations
            const azureGroupId = await this.createAzureSecurityGroup( groupName, request, workflowState );
            await this.addGroupMembers( azureGroupId, request.owners, request.members, workflowState );
            await this.configureEnterpriseApplication( azureGroupId, workflowState );

            // Phase 3: Synchronization and Verification
            await this.triggerProvisioning( azureGroupId, workflowState );
            await this.verifyAWSSynchronization( azureGroupId, workflowState );

            // Phase 4: AWS Configuration
            const permissionSetArn = await this.createAWSPermissionSet( groupName, request, workflowState );
            const awsAccountId = this.config.aws.accountMapping[ request.accountType ];
            await this.configureAccountAssignment( azureGroupId, awsAccountId, permissionSetArn, workflowState );

            // Phase 5: Validation and Completion
            const validationResults = await this.performEndToEndValidation( azureGroupId, permissionSetArn, awsAccountId, workflowState );

            // Create assignment record
            const assignment: GroupAssignment = {
                azureGroupId,
                azureGroupName: groupName,
                awsAccountId,
                permissionSetArn,
                assignmentStatus: 'ACTIVE',
                createdDate: new Date()
            };

            operation.assignments = [ assignment ];
            operation.status = 'COMPLETED';
            operation.endTime = new Date();
            workflowState.currentStep = 'COMPLETED';

            const result: AccessGrantResult = {
                groupName,
                azureGroupId,
                permissionSetArn,
                awsAccountId,
                operation,
                validationResults
            };

            await this.operationHistoryStorage.addOperation( operation );
            return result;

        } catch ( error ) {
            operation.status = 'FAILED';
            operation.endTime = new Date();
            workflowState.currentStep = 'FAILED';

            const operationError: OperationError = {
                code: 'ACCESS_GRANT_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                timestamp: new Date()
            };
            operation.errors.push( operationError );
            workflowState.errors.push( operationError );

            // Attempt rollback
            await this.performRollback( workflowState );

            throw error;
        }
    }

    /**
     * Generate standardized group name following convention
     * Format: CE-AWS-<Account>-<TicketId>
     */
    private generateGroupName( accountType: string, ticketId: string ): string {
        // Validate ticket ID format
        if ( !/^AG-\d{3,4}$/.test( ticketId ) ) {
            throw new Error( `Invalid ticket ID format: ${ticketId}. Expected format: AG-XXX or AG-XXXX` );
        }

        return `CE-AWS-${accountType}-${ticketId}`;
    }

    /**
     * Phase 1: Validate access grant request
     */
    private async validateAccessGrantRequest( request: AccessGrantRequest, workflowState: WorkflowState ): Promise<void> {
        workflowState.currentStep = 'VALIDATION';

        try {
            // Validate account type
            if ( ![ 'Dev', 'QA', 'Staging', 'Prod' ].includes( request.accountType ) ) {
                throw new Error( `Invalid account type: ${request.accountType}. Must be one of: Dev, QA, Staging, Prod` );
            }

            // Validate ticket ID format
            if ( !/^AG-\d{3,4}$/.test( request.ticketId ) ) {
                throw new Error( `Invalid ticket ID format: ${request.ticketId}. Expected format: AG-XXX or AG-XXXX` );
            }

            // Validate users exist in Azure AD
            const allUsers = [ ...request.owners, ...request.members ];
            for ( const userEmail of allUsers ) {
                // This would need to be implemented in AzureClient
                // await this.azureClient.validateUser(userEmail);
            }

            // Check if group name already exists
            const groupName = this.generateGroupName( request.accountType, request.ticketId );
            const existingGroups = await this.azureClient.listSecurityGroups( groupName );
            if ( existingGroups.length > 0 ) {
                throw new Error( `Group with name ${groupName} already exists` );
            }

            workflowState.completedSteps.push( 'VALIDATION' );

        } catch ( error ) {
            const operationError: OperationError = {
                code: 'VALIDATION_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: { request },
                timestamp: new Date()
            };
            workflowState.errors.push( operationError );
            throw error;
        }
    }

    /**
     * Phase 2: Create Azure security group
     */
    private async createAzureSecurityGroup( groupName: string, request: AccessGrantRequest, workflowState: WorkflowState ): Promise<string> {
        workflowState.currentStep = 'AZURE_GROUP_CREATION';

        try {
            // Create the security group using Azure client
            const groupResult = await this.azureClient.createSecurityGroup(
                groupName,
                request.description || `Access grant for ${request.accountType} environment - Ticket: ${request.ticketId}`
            );

            if ( !groupResult.success || !groupResult.groupId ) {
                throw new Error( `Group creation failed: ${groupResult.errors.join( ', ' )}` );
            }

            const groupId = groupResult.groupId;

            workflowState.rollbackActions.push( {
                type: 'DELETE_AZURE_GROUP',
                data: { groupId, groupName }
            } );

            workflowState.completedSteps.push( 'AZURE_GROUP_CREATION' );
            return groupId;

        } catch ( error ) {
            const operationError: OperationError = {
                code: 'AZURE_GROUP_CREATION_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: { groupName },
                timestamp: new Date()
            };
            workflowState.errors.push( operationError );
            throw error;
        }
    }

    /**
     * Phase 2: Add members to Azure group
     */
    private async addGroupMembers( groupId: string, owners: string[], members: string[], workflowState: WorkflowState ): Promise<void> {
        workflowState.currentStep = 'AZURE_GROUP_MEMBERS';

        try {
            // Add owners
            for ( const ownerEmail of owners ) {
                const ownerResult = await this.azureClient.addGroupOwner( groupId, ownerEmail );
                if ( !ownerResult.success ) {
                    throw new Error( `Failed to add owner ${ownerEmail}: ${ownerResult.errors.join( ', ' )}` );
                }
            }

            // Add members
            for ( const memberEmail of members ) {
                const memberResult = await this.azureClient.addGroupMember( groupId, memberEmail );
                if ( !memberResult.success ) {
                    throw new Error( `Failed to add member ${memberEmail}: ${memberResult.errors.join( ', ' )}` );
                }
            }

            workflowState.completedSteps.push( 'AZURE_GROUP_MEMBERS' );

        } catch ( error ) {
            const operationError: OperationError = {
                code: 'AZURE_GROUP_MEMBERS_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: { groupId, owners, members },
                timestamp: new Date()
            };
            workflowState.errors.push( operationError );
            throw error;
        }
    }

    /**
     * Phase 2: Configure enterprise application assignment
     */
    private async configureEnterpriseApplication( groupId: string, workflowState: WorkflowState ): Promise<void> {
        workflowState.currentStep = 'ENTERPRISE_APP_CONFIG';

        try {
            // Assign group to enterprise application
            const assignmentResult = await this.azureClient.assignGroupToEnterpriseApp(
                groupId,
                this.config.azure.enterpriseApplicationId
            );

            if ( !assignmentResult.success ) {
                throw new Error( `Enterprise app assignment failed: ${assignmentResult.errors.join( ', ' )}` );
            }

            // Store rollback action with assignment ID if available
            workflowState.rollbackActions.push( {
                type: 'REMOVE_ENTERPRISE_APP_ASSIGNMENT',
                data: {
                    groupId,
                    enterpriseAppId: this.config.azure.enterpriseApplicationId,
                    assignmentId: assignmentResult.assignmentId
                }
            } );

            workflowState.completedSteps.push( 'ENTERPRISE_APP_CONFIG' );

        } catch ( error ) {
            const operationError: OperationError = {
                code: 'ENTERPRISE_APP_CONFIG_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: { groupId },
                timestamp: new Date()
            };
            workflowState.errors.push( operationError );
            throw error;
        }
    }

    /**
     * Phase 3: Trigger provisioning
     */
    private async triggerProvisioning( groupId: string, workflowState: WorkflowState ): Promise<void> {
        workflowState.currentStep = 'PROVISIONING';

        try {
            // Trigger on-demand provisioning
            const provisioningResult = await this.azureClient.triggerProvisionOnDemand(
                groupId,
                this.config.azure.enterpriseApplicationId
            );

            if ( !provisioningResult.success ) {
                console.warn( `On-demand provisioning failed, continuing with normal sync: ${provisioningResult.errors.join( ', ' )}` );
            }

            // Wait for provisioning to complete with timeout
            const maxWaitTime = 300000; // 5 minutes
            const startTime = Date.now();

            while ( Date.now() - startTime < maxWaitTime ) {
                // Check provisioning status
                const statusResult = await this.azureClient.getProvisioningStatus(
                    groupId,
                    this.config.azure.enterpriseApplicationId
                );

                if ( statusResult.status === 'Provisioned' ) {
                    break;
                } else if ( statusResult.status === 'Failed' ) {
                    throw new Error( `Provisioning failed: ${statusResult.errors.join( ', ' )}` );
                }

                await new Promise( resolve => setTimeout( resolve, 10000 ) ); // Wait 10 seconds
            }

            workflowState.completedSteps.push( 'PROVISIONING' );

        } catch ( error ) {
            const operationError: OperationError = {
                code: 'PROVISIONING_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: { groupId },
                timestamp: new Date()
            };
            workflowState.errors.push( operationError );
            throw error;
        }
    }

    /**
     * Phase 3: Verify AWS synchronization
     */
    private async verifyAWSSynchronization( azureGroupId: string, workflowState: WorkflowState ): Promise<void> {
        workflowState.currentStep = 'AWS_SYNC_VERIFICATION';

        try {
            const maxRetries = 12; // 2 minutes with 10-second intervals
            let retries = 0;

            while ( retries < maxRetries ) {
                const syncStatus = await this.awsClient.checkGroupSynchronizationStatus( azureGroupId );
                if ( syncStatus.isSynced ) {
                    workflowState.completedSteps.push( 'AWS_SYNC_VERIFICATION' );
                    return;
                }

                retries++;
                if ( retries < maxRetries ) {
                    await new Promise( resolve => setTimeout( resolve, 10000 ) ); // Wait 10 seconds
                }
            }

            throw new Error( `Group ${azureGroupId} failed to sync to AWS after ${maxRetries} attempts` );

        } catch ( error ) {
            const operationError: OperationError = {
                code: 'AWS_SYNC_VERIFICATION_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: { azureGroupId },
                timestamp: new Date()
            };
            workflowState.errors.push( operationError );
            throw error;
        }
    }

    /**
     * Phase 4: Create AWS permission set
     */
    private async createAWSPermissionSet( groupName: string, request: AccessGrantRequest, workflowState: WorkflowState ): Promise<string> {
        workflowState.currentStep = 'AWS_PERMISSION_SET_CREATION';

        try {
            let permissionSet: PermissionSet;

            if ( request.permissionTemplate ) {
                // Use template
                permissionSet = await this.permissionSetManager.createFromTemplate(
                    request.permissionTemplate,
                    {
                        name: groupName,
                        description: `Permission set for ${groupName} - ${request.accountType} environment`,
                        ...request.customPermissions
                    }
                );
            } else {
                // Create custom permission set
                permissionSet = await this.permissionSetManager.createCustomPermissionSet( {
                    name: groupName,
                    description: `Permission set for ${groupName} - ${request.accountType} environment`,
                    ...request.customPermissions
                } );
            }

            workflowState.rollbackActions.push( {
                type: 'DELETE_PERMISSION_SET',
                data: { permissionSetArn: permissionSet.arn }
            } );

            workflowState.completedSteps.push( 'AWS_PERMISSION_SET_CREATION' );
            return permissionSet.arn;

        } catch ( error ) {
            const operationError: OperationError = {
                code: 'AWS_PERMISSION_SET_CREATION_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: { groupName, request },
                timestamp: new Date()
            };
            workflowState.errors.push( operationError );
            throw error;
        }
    }

    /**
     * Phase 4: Configure account assignment
     */
    private async configureAccountAssignment( azureGroupId: string, awsAccountId: string, permissionSetArn: string, workflowState: WorkflowState ): Promise<void> {
        workflowState.currentStep = 'AWS_ACCOUNT_ASSIGNMENT';

        try {
            await this.awsClient.assignGroupToAccount( azureGroupId, awsAccountId, permissionSetArn );

            workflowState.rollbackActions.push( {
                type: 'DELETE_ASSIGNMENT',
                data: {
                    groupId: azureGroupId,
                    accountId: awsAccountId,
                    permissionSetArn
                }
            } );

            workflowState.completedSteps.push( 'AWS_ACCOUNT_ASSIGNMENT' );

        } catch ( error ) {
            const operationError: OperationError = {
                code: 'AWS_ACCOUNT_ASSIGNMENT_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: { azureGroupId, awsAccountId, permissionSetArn },
                timestamp: new Date()
            };
            workflowState.errors.push( operationError );
            throw error;
        }
    }

    /**
     * Phase 5: Perform end-to-end validation
     */
    private async performEndToEndValidation( azureGroupId: string, permissionSetArn: string, awsAccountId: string, workflowState: WorkflowState ): Promise<any> {
        workflowState.currentStep = 'END_TO_END_VALIDATION';

        try {
            const results = {
                groupSynced: false,
                permissionSetCreated: false,
                assignmentActive: false,
                usersCanAccess: false
            };

            // Check group synchronization
            const syncStatus = await this.awsClient.checkGroupSynchronizationStatus( azureGroupId );
            results.groupSynced = syncStatus.isSynced;

            // Check permission set exists
            const permissionSets = await this.awsClient.listPermissionSets();
            results.permissionSetCreated = permissionSets.some( ps => ps.arn === permissionSetArn );

            // Check assignment is active
            const assignments = await this.awsClient.listAccountAssignments();
            results.assignmentActive = assignments.some( a =>
                a.principalId === azureGroupId &&
                a.permissionSetArn === permissionSetArn &&
                a.accountId === awsAccountId &&
                a.status === 'PROVISIONED'
            );

            // Additional validation could include testing actual user access
            results.usersCanAccess = results.groupSynced && results.permissionSetCreated && results.assignmentActive;

            workflowState.completedSteps.push( 'END_TO_END_VALIDATION' );
            return results;

        } catch ( error ) {
            const operationError: OperationError = {
                code: 'END_TO_END_VALIDATION_FAILED',
                message: error instanceof Error ? error.message : 'Unknown error',
                details: { azureGroupId, permissionSetArn, awsAccountId },
                timestamp: new Date()
            };
            workflowState.errors.push( operationError );
            throw error;
        }
    }

    /**
     * List access grants by account type
     */
    async listAccessGrants( accountType?: 'Dev' | 'QA' | 'Staging' | 'Prod' ): Promise<AccessGrantResult[]> {
        const results: AccessGrantResult[] = [];
        const operations = await this.operationHistoryStorage.getAllOperations();

        for ( const operation of operations ) {
            if ( operation.operationType === 'CREATE' && operation.assignments.length > 0 ) {
                const assignment = operation.assignments[ 0 ];

                // Filter by account type if specified
                if ( accountType ) {
                    const expectedAccountId = this.config.aws.accountMapping[ accountType ];
                    if ( assignment.awsAccountId !== expectedAccountId ) {
                        continue;
                    }
                }

                results.push( {
                    groupName: assignment.azureGroupName,
                    azureGroupId: assignment.azureGroupId,
                    permissionSetArn: assignment.permissionSetArn,
                    awsAccountId: assignment.awsAccountId,
                    operation
                } );
            }
        }

        return results;
    }

    /**
     * Validate existing access grant
     */
    async validateAccessGrant( groupName: string ): Promise<any> {
        try {
            // Find the group in Azure AD
            const groups = await this.azureClient.listSecurityGroups( groupName );
            const group = groups.find( g => g.displayName === groupName );

            if ( !group ) {
                throw new Error( `Group ${groupName} not found in Azure AD` );
            }

            // Validate the group follows naming convention
            const nameParts = groupName.split( '-' );
            if ( nameParts.length !== 4 || nameParts[ 0 ] !== 'CE' || nameParts[ 1 ] !== 'AWS' ) {
                throw new Error( `Group name ${groupName} does not follow naming convention` );
            }

            const accountType = nameParts[ 2 ] as 'Dev' | 'QA' | 'Staging' | 'Prod';
            const ticketId = nameParts[ 3 ];

            // Validate components
            const validation = await this.azureClient.validateGroupDetailed( group.id );
            const syncStatus = await this.awsClient.checkGroupSynchronizationStatus( group.id );

            // Find corresponding permission set and assignment
            const permissionSets = await this.awsClient.listPermissionSets();
            const permissionSet = permissionSets.find( ps => ps.name === groupName );

            const assignments = await this.awsClient.listAccountAssignments();
            const assignment = assignments.find( a =>
                a.principalId === group.id &&
                a.accountId === this.config.aws.accountMapping[ accountType ]
            );

            return {
                groupName,
                accountType,
                ticketId,
                azureGroup: {
                    exists: validation.exists,
                    isValid: validation.isValid,
                    memberCount: validation.memberCount,
                    errors: validation.errors
                },
                synchronization: {
                    isSynced: syncStatus.isSynced,
                    awsGroupId: syncStatus.awsGroupId,
                    lastSyncTime: syncStatus.lastSyncTime
                },
                permissionSet: {
                    exists: !!permissionSet,
                    arn: permissionSet?.arn,
                    name: permissionSet?.name
                },
                assignment: {
                    exists: !!assignment,
                    status: assignment?.status,
                    accountId: assignment?.accountId
                }
            };

        } catch ( error ) {
            throw new Error( `Validation failed for ${groupName}: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    // Rollback Implementation Methods for Requirements 7.3

    /**
     * Rollback: Delete Azure AD group
     */
    private async rollbackDeleteAzureGroup( data: Record<string, unknown> ): Promise<void> {
        const groupId = data.groupId as string;
        const groupName = data.groupName as string;

        if ( !groupId ) {
            throw new Error( 'Group ID is required for Azure group deletion rollback' );
        }

        console.log( `Rollback: Deleting Azure group ${groupId} (${groupName})` );

        try {
            const result = await this.azureClient.deleteGroup( groupId );
            if ( !result.success ) {
                throw new Error( `Failed to delete Azure group ${groupId}: ${result.errors.join( ', ' )}` );
            }

            console.log( `Rollback: Successfully deleted Azure group ${groupId}` );
        } catch ( error ) {
            // If the group doesn't exist, consider it a successful rollback
            if ( error instanceof Error && ( error.message.includes( 'not found' ) || error.message.includes( 'does not exist' ) ) ) {
                console.log( `Rollback: Azure group ${groupId} already deleted or doesn't exist` );
                return;
            }
            throw error;
        }
    }

    /**
     * Rollback: Remove enterprise application assignment
     */
    private async rollbackRemoveEnterpriseAppAssignment( data: Record<string, unknown> ): Promise<void> {
        const groupId = data.groupId as string;
        const enterpriseAppId = data.enterpriseAppId as string;
        const assignmentId = data.assignmentId as string;

        if ( !groupId || !enterpriseAppId ) {
            throw new Error( 'Group ID and Enterprise App ID are required for enterprise app assignment removal rollback' );
        }

        console.log( `Rollback: Removing enterprise app assignment for group ${groupId}` );

        try {
            let result;
            if ( assignmentId ) {
                // Remove specific assignment if we have the ID
                result = await this.azureClient.removeAppRoleAssignment( groupId, assignmentId );
            } else {
                // Remove all assignments for this group and enterprise app
                result = await this.azureClient.removeGroupFromEnterpriseApp( groupId, enterpriseAppId );
            }

            if ( !result.success ) {
                throw new Error( `Failed to remove enterprise app assignment for group ${groupId}: ${result.errors.join( ', ' )}` );
            }

            console.log( `Rollback: Successfully removed enterprise app assignment for group ${groupId}` );
        } catch ( error ) {
            // If the assignment doesn't exist, consider it a successful rollback
            if ( error instanceof Error && ( error.message.includes( 'not found' ) || error.message.includes( 'does not exist' ) ) ) {
                console.log( `Rollback: Enterprise app assignment for group ${groupId} already removed or doesn't exist` );
                return;
            }
            throw error;
        }
    }

    /**
     * Rollback: Delete AWS assignment
     */
    private async rollbackDeleteAssignment( data: Record<string, unknown> ): Promise<void> {
        const groupId = data.groupId as string;
        const accountId = data.accountId as string;
        const permissionSetArn = data.permissionSetArn as string;

        if ( !groupId || !accountId || !permissionSetArn ) {
            throw new Error( 'Group ID, Account ID, and Permission Set ARN are required for assignment deletion rollback' );
        }

        console.log( `Rollback: Deleting AWS assignment for group ${groupId} in account ${accountId}` );

        try {
            const result = await this.awsClient.deleteAccountAssignment( groupId, accountId, permissionSetArn );

            // Wait for deletion to complete with proper error handling
            const maxRetries = 30; // 5 minutes with 10-second intervals
            let retries = 0;

            while ( retries < maxRetries ) {
                try {
                    const status = await this.awsClient.validateAssignmentDeletionStatus( result.requestId );

                    if ( status.status === 'SUCCEEDED' ) {
                        console.log( `Rollback: Successfully deleted AWS assignment for group ${groupId}` );
                        return;
                    } else if ( status.status === 'FAILED' ) {
                        throw new Error( `AWS assignment deletion failed: ${status.failureReason || 'Unknown error'}` );
                    }

                    // Status is IN_PROGRESS, continue waiting
                    retries++;
                    if ( retries < maxRetries ) {
                        await new Promise( resolve => setTimeout( resolve, 10000 ) ); // Wait 10 seconds
                    }
                } catch ( statusError ) {
                    // If status check fails, retry a few times before giving up
                    if ( retries >= 3 ) {
                        throw new Error( `Failed to check assignment deletion status: ${statusError instanceof Error ? statusError.message : 'Unknown error'}` );
                    }
                    retries++;
                    await new Promise( resolve => setTimeout( resolve, 10000 ) );
                }
            }

            throw new Error( `AWS assignment deletion timed out after ${maxRetries} attempts` );
        } catch ( error ) {
            // If the assignment doesn't exist, consider it a successful rollback
            if ( error instanceof Error && ( error.message.includes( 'not found' ) || error.message.includes( 'does not exist' ) ) ) {
                console.log( `Rollback: AWS assignment for group ${groupId} already deleted or doesn't exist` );
                return;
            }
            throw error;
        }
    }

    /**
     * Rollback: Delete AWS permission set
     */
    private async rollbackDeletePermissionSet( data: Record<string, unknown> ): Promise<void> {
        const permissionSetArn = data.permissionSetArn as string;

        if ( !permissionSetArn ) {
            throw new Error( 'Permission Set ARN is required for permission set deletion rollback' );
        }

        console.log( `Rollback: Deleting AWS permission set ${permissionSetArn}` );

        try {
            await this.awsClient.deletePermissionSet( permissionSetArn );
            console.log( `Rollback: Successfully deleted AWS permission set ${permissionSetArn}` );
        } catch ( error ) {
            // If the permission set doesn't exist, consider it a successful rollback
            if ( error instanceof Error && ( error.message.includes( 'not found' ) || error.message.includes( 'does not exist' ) ) ) {
                console.log( `Rollback: AWS permission set ${permissionSetArn} already deleted or doesn't exist` );
                return;
            }

            // Check if permission set is still in use
            if ( error instanceof Error && ( error.message.includes( 'in use' ) || error.message.includes( 'has assignments' ) ) ) {
                console.warn( `Rollback: Cannot delete permission set ${permissionSetArn} - still in use. Manual cleanup may be required.` );
                return;
            }

            throw error;
        }
    }

    /**
     * Rollback: Restore assignment (placeholder for future implementation)
     */
    private async rollbackRestoreAssignment( data: Record<string, unknown> ): Promise<void> {
        const assignmentId = data.assignmentId as string;

        console.log( `Rollback: Restoring assignment ${assignmentId} (not yet implemented)` );

        // This would require storing previous assignment state and restoring it
        // For now, this is a placeholder that logs the action
        console.warn( `Rollback: Assignment restoration for ${assignmentId} is not yet implemented` );
    }
}
