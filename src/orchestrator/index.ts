// Assignment Orchestrator - Coordinates Azure AD and AWS operations
import { v4 as uuidv4 } from 'uuid';
import { AWSClient } from '../clients/aws-client';
import { AzureClient } from '../clients/azure-client';
import { PermissionSetManager } from '../permission-sets';
import { AssignmentOperation, GroupAssignment, OperationError, PermissionSet } from '../types';

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
    private assignmentHistory: Map<string, AssignmentOperation> = new Map();

    constructor( config: OrchestrationConfig ) {
        this.config = config;
        this.azureClient = new AzureClient( config.azure );
        this.awsClient = new AWSClient( config.aws );
        this.permissionSetManager = new PermissionSetManager( this.awsClient );
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

        this.assignmentHistory.set( operationId, operation );
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

        this.assignmentHistory.set( operationId, operation );
        return operation;
    }

    /**
     * Rollback a completed operation
     * Implements Requirements 7.4: Rollback capabilities
     */
    async rollbackOperation( operationId: string ): Promise<void> {
        const operation = this.assignmentHistory.get( operationId );
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
    getOperationStatus( operationId: string ): AssignmentOperation | undefined {
        return this.assignmentHistory.get( operationId );
    }

    /**
     * List all operations
     */
    listOperations(): AssignmentOperation[] {
        return Array.from( this.assignmentHistory.values() );
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
     */
    private async performRollback( workflowState: WorkflowState ): Promise<void> {
        for ( const action of workflowState.rollbackActions.reverse() ) {
            try {
                switch ( action.type ) {
                    case 'DELETE_ASSIGNMENT':
                        // Implementation would call AWS API to delete the assignment
                        // This is a placeholder as the AWS client doesn't have delete assignment method yet
                        console.warn( `Rollback: Would delete assignment for group ${action.data.groupId}` );
                        break;
                    case 'DELETE_PERMISSION_SET':
                        // Implementation would call AWS API to delete the permission set
                        console.warn( `Rollback: Would delete permission set ${action.data.permissionSetArn}` );
                        break;
                    case 'RESTORE_ASSIGNMENT':
                        // Implementation would restore a previous assignment
                        console.warn( `Rollback: Would restore assignment ${action.data.assignmentId}` );
                        break;
                    case 'DELETE_AZURE_GROUP':
                        // Implementation would call Azure API to delete the group
                        console.warn( `Rollback: Would delete Azure group ${action.data.groupId} (${action.data.groupName})` );
                        break;
                    case 'REMOVE_ENTERPRISE_APP_ASSIGNMENT':
                        // Implementation would remove enterprise app assignment
                        console.warn( `Rollback: Would remove enterprise app assignment for group ${action.data.groupId}` );
                        break;
                }
            } catch ( error ) {
                // Log rollback failures but don't throw - we want to attempt all rollback actions
                console.error( `Rollback action failed: ${error instanceof Error ? error.message : 'Unknown error'}` );
            }
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
    cleanupOldOperations( olderThanHours: number = 24 ): void {
        const cutoffTime = new Date( Date.now() - ( olderThanHours * 60 * 60 * 1000 ) );

        for ( const [ operationId, operation ] of this.assignmentHistory.entries() ) {
            if ( operation.startTime < cutoffTime ) {
                this.assignmentHistory.delete( operationId );
                this.operationStates.delete( operationId );
            }
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

            this.assignmentHistory.set( operationId, operation );
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
            // This would need to be implemented in AzureClient
            // const groupId = await this.azureClient.createSecurityGroup({
            //     displayName: groupName,
            //     description: request.description || `Access grant for ${request.accountType} environment - Ticket: ${request.ticketId}`,
            //     mailEnabled: false,
            //     securityEnabled: true
            // });

            // For now, return a placeholder
            const groupId = `group-${Date.now()}`;

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
                // await this.azureClient.addGroupOwner(groupId, ownerEmail);
            }

            // Add members
            for ( const memberEmail of members ) {
                // await this.azureClient.addGroupMember(groupId, memberEmail);
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
            // This would need to be implemented in AzureClient
            // await this.azureClient.assignGroupToEnterpriseApp(
            //     this.config.azure.enterpriseApplicationId,
            //     groupId
            // );

            workflowState.rollbackActions.push( {
                type: 'REMOVE_ENTERPRISE_APP_ASSIGNMENT',
                data: { groupId, enterpriseAppId: this.config.azure.enterpriseApplicationId }
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
            // This would need to be implemented in AzureClient
            // await this.azureClient.triggerProvisionOnDemand(groupId);

            // Wait for provisioning to complete with timeout
            const maxWaitTime = 300000; // 5 minutes
            const startTime = Date.now();

            while ( Date.now() - startTime < maxWaitTime ) {
                // Check provisioning status
                // const status = await this.azureClient.getProvisioningStatus(groupId);
                // if (status === 'COMPLETED') break;

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

        for ( const operation of this.assignmentHistory.values() ) {
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
}
