// Azure AD Client - placeholder for task 2.1
import { AzureGroup } from '../types';

export class AzureClient {
    constructor( private config: { tenantId: string; clientId: string; clientSecret: string } ) {
        // Constructor implementation will be added in task 2.1
    }

    async listSecurityGroups(): Promise<AzureGroup[]> {
        // Implementation will be added in task 2.1
        throw new Error( 'Not implemented yet' );
    }

    async getGroupMembers( _groupId: string ): Promise<unknown[]> {
        // Implementation will be added in task 2.1
        throw new Error( 'Not implemented yet' );
    }

    async validateGroup( _groupId: string ): Promise<boolean> {
        // Implementation will be added in task 2.2
        throw new Error( 'Not implemented yet' );
    }
}
