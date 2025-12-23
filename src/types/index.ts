// Type definitions for AWS Access Grants (aws-ag)

export interface AzureGroup {
    id: string;
    displayName: string;
    description?: string;
    groupType: 'Security' | 'Distribution' | 'Microsoft365';
    memberCount: number;
    isAssignedToAWS: boolean;
    lastSyncTime?: Date;
}

export interface PermissionSet {
    arn: string;
    name: string;
    description?: string;
    sessionDuration: string;
    managedPolicies: string[];
    inlinePolicy?: string;
    tags: Record<string, string>;
    accountAssignments: AccountAssignment[];
}

export interface AccountAssignment {
    accountId: string;
    principalId: string;
    principalType: 'USER' | 'GROUP';
    permissionSetArn: string;
    status: 'PROVISIONED' | 'IN_PROGRESS' | 'FAILED';
}

export interface GroupAssignment {
    azureGroupId: string;
    azureGroupName: string;
    awsAccountId: string;
    permissionSetArn: string;
    assignmentStatus: 'PENDING' | 'ACTIVE' | 'FAILED';
    createdDate: Date;
    lastValidated?: Date;
}

export interface AssignmentOperation {
    operationId: string;
    operationType: 'CREATE' | 'DELETE' | 'UPDATE';
    assignments: GroupAssignment[];
    status: 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
    errors: OperationError[];
    startTime: Date;
    endTime?: Date;
}

export interface OperationError {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    timestamp: Date;
}

export interface ToolConfig {
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
    logging: {
        level: 'debug' | 'info' | 'warn' | 'error';
        file?: string;
    };
}
