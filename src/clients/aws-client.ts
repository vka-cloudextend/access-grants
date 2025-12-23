// AWS IAM Identity Center Client - placeholder for task 3
import { PermissionSet, AccountAssignment } from '../types';

export class AWSClient {
    constructor( private config: { region: string; identityCenterInstanceArn: string; identityStoreId: string } ) {
        // Constructor implementation will be added in task 3.1
    }

    async listPermissionSets(): Promise<PermissionSet[]> {
        // Implementation will be added in task 3.1
        throw new Error( 'Not implemented yet' );
    }

    async createPermissionSet( _name: string, _description?: string ): Promise<PermissionSet> {
        // Implementation will be added in task 3.1
        throw new Error( 'Not implemented yet' );
    }

    async assignGroupToAccount( _groupId: string, _accountId: string, _permissionSetArn: string ): Promise<AccountAssignment> {
        // Implementation will be added in task 3.1
        throw new Error( 'Not implemented yet' );
    }

    async listAccountAssignments(): Promise<AccountAssignment[]> {
        // Implementation will be added in task 3.2
        throw new Error( 'Not implemented yet' );
    }
}
