// Azure AD Client - Microsoft Graph SDK integration
import { Client } from '@microsoft/microsoft-graph-client';
import { ConfidentialClientApplication } from '@azure/msal-node';
import { AzureGroup } from '../types';

interface AzureConfig {
    tenantId: string;
    clientId: string;
    clientSecret: string;
}

interface GraphGroup {
    id?: string;
    displayName?: string;
    description?: string;
    groupTypes?: string[];
    securityEnabled?: boolean;
    mailEnabled?: boolean;
}

interface GroupMember {
    id?: string;
    displayName?: string;
    userPrincipalName?: string;
    '@odata.type'?: string;
}

export class AzureClient {
    private graphClient: Client;
    private config: AzureConfig;
    private msalClient: ConfidentialClientApplication;

    constructor( config: AzureConfig ) {
        this.config = config;

        // Initialize MSAL confidential client application
        this.msalClient = new ConfidentialClientApplication( {
            auth: {
                clientId: config.clientId,
                clientSecret: config.clientSecret,
                authority: `https://login.microsoftonline.com/${config.tenantId}`
            }
        } );

        // Initialize Microsoft Graph client with custom auth provider
        this.graphClient = Client.initWithMiddleware( {
            authProvider: {
                getAccessToken: async () => {
                    const clientCredentialRequest = {
                        scopes: [ 'https://graph.microsoft.com/.default' ]
                    };

                    try {
                        const response = await this.msalClient.acquireTokenByClientCredential( clientCredentialRequest );
                        return response?.accessToken || '';
                    } catch ( error ) {
                        throw new Error( `Failed to acquire access token: ${error instanceof Error ? error.message : 'Unknown error'}` );
                    }
                }
            }
        } );
    }

    /**
     * List security groups with optional filtering
     * Implements Requirements 1.1: Retrieve and display available Azure AD security groups
     */
    async listSecurityGroups( filter?: string ): Promise<AzureGroup[]> {
        try {
            let query = this.graphClient
                .api( '/groups' )
                .select( 'id,displayName,description,groupTypes,securityEnabled,mailEnabled' )
                .filter( 'securityEnabled eq true' );

            // Add additional filter if provided
            if ( filter ) {
                query = query.filter( `securityEnabled eq true and (contains(displayName,'${filter}') or contains(description,'${filter}'))` );
            }

            const response = await query.get();
            const groups: GraphGroup[] = response.value || [];

            // Convert to AzureGroup format
            const azureGroups: AzureGroup[] = [];

            for ( const group of groups ) {
                if ( !group.id || !group.displayName ) continue;

                // Get member count for each group
                const memberCount = await this.getGroupMemberCount( group.id );

                // Determine group type
                const groupType = this.determineGroupType( group );

                // Check if group is already assigned to AWS
                const isAssignedToAWS = await this.isGroupAssignedToAWS( group.id );

                azureGroups.push( {
                    id: group.id,
                    displayName: group.displayName,
                    description: group.description,
                    groupType,
                    memberCount,
                    isAssignedToAWS,
                    lastSyncTime: undefined
                } );
            }

            return azureGroups;
        } catch ( error ) {
            throw new Error( `Failed to list security groups: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Get group members for a specific group
     * Implements Requirements 1.3: Retrieve group membership information
     */
    async getGroupMembers( groupId: string ): Promise<GroupMember[]> {
        try {
            const response = await this.graphClient
                .api( `/groups/${groupId}/members` )
                .select( 'id,displayName,userPrincipalName' )
                .get();

            return response.value || [];
        } catch ( error ) {
            throw new Error( `Failed to get group members for ${groupId}: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Get the count of members in a group (more efficient than getting all members)
     */
    private async getGroupMemberCount( groupId: string ): Promise<number> {
        try {
            const response = await this.graphClient
                .api( `/groups/${groupId}/members/$count` )
                .get();

            return typeof response === 'number' ? response : 0;
        } catch ( error ) {
            // If count API fails, fall back to getting members and counting
            try {
                const members = await this.getGroupMembers( groupId );
                return members.length;
            } catch {
                return 0;
            }
        }
    }

    /**
     * Determine the group type based on Graph API properties
     */
    private determineGroupType( group: GraphGroup ): 'Security' | 'Distribution' | 'Microsoft365' {
        const groupTypes = group.groupTypes || [];

        if ( groupTypes.includes( 'Unified' ) ) {
            return 'Microsoft365';
        } else if ( group.securityEnabled && !group.mailEnabled ) {
            return 'Security';
        } else if ( !group.securityEnabled && group.mailEnabled ) {
            return 'Distribution';
        } else {
            // Default to Security for security-enabled groups
            return 'Security';
        }
    }

    /**
     * Check if a group exists and is accessible
     */
    async groupExists( groupId: string ): Promise<boolean> {
        try {
            await this.graphClient
                .api( `/groups/${groupId}` )
                .select( 'id' )
                .get();
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Validate a group for AWS assignment
     * Implements Requirements 1.2, 1.3: Check if groups are already configured, verify groups are active and have members
     */
    async validateGroup( groupId: string ): Promise<boolean> {
        try {
            // Check if group exists and is accessible
            const groupExists = await this.groupExists( groupId );
            if ( !groupExists ) {
                return false;
            }

            // Get group details
            const groupDetails = await this.getGroupDetails( groupId );
            if ( !groupDetails ) {
                return false;
            }

            // Validate group type (security groups only)
            if ( !this.isSecurityGroup( groupDetails ) ) {
                return false;
            }

            // Check if group is active
            if ( !this.isGroupActive( groupDetails ) ) {
                return false;
            }

            // Check if group has members
            const memberCount = await this.getGroupMemberCount( groupId );
            if ( memberCount === 0 ) {
                return false;
            }

            return true;
        } catch ( error ) {
            throw new Error( `Failed to validate group ${groupId}: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Get detailed group information
     */
    private async getGroupDetails( groupId: string ): Promise<GraphGroup | null> {
        try {
            const response = await this.graphClient
                .api( `/groups/${groupId}` )
                .select( 'id,displayName,description,groupTypes,securityEnabled,mailEnabled,deletedDateTime' )
                .get();

            return response;
        } catch {
            return null;
        }
    }

    /**
     * Check if a group is a security group
     * Implements Requirements 1.2: Validate group types (security groups only)
     */
    private isSecurityGroup( group: GraphGroup ): boolean {
        return group.securityEnabled === true;
    }

    /**
     * Check if a group is active (not deleted)
     * Implements Requirements 1.2: Check if groups are active
     */
    private isGroupActive( group: GraphGroup & { deletedDateTime?: string } ): boolean {
        return !group.deletedDateTime;
    }

    /**
     * Check if a group is already assigned to AWS
     * Implements Requirements 1.2: Check if groups are already configured in AWS IAM Identity Center
     * Note: This is a placeholder that will be implemented when AWS client is available
     */
    async isGroupAssignedToAWS( groupId: string ): Promise<boolean> {
        // TODO: Implement AWS cross-reference when AWS client is available in task 3
        // This should check if the group is already assigned to any AWS accounts/permission sets
        console.warn( `AWS cross-reference not yet implemented for group ${groupId}` );
        return false;
    }

    /**
     * Comprehensive group validation with detailed results
     * Provides detailed validation information for troubleshooting
     */
    async validateGroupDetailed( groupId: string ): Promise<{
        isValid: boolean;
        exists: boolean;
        isSecurityGroup: boolean;
        isActive: boolean;
        hasMembers: boolean;
        memberCount: number;
        isAssignedToAWS: boolean;
        errors: string[];
    }> {
        const result = {
            isValid: false,
            exists: false,
            isSecurityGroup: false,
            isActive: false,
            hasMembers: false,
            memberCount: 0,
            isAssignedToAWS: false,
            errors: [] as string[]
        };

        try {
            // Check existence
            result.exists = await this.groupExists( groupId );
            if ( !result.exists ) {
                result.errors.push( 'Group does not exist or is not accessible' );
                return result;
            }

            // Get group details
            const groupDetails = await this.getGroupDetails( groupId );
            if ( !groupDetails ) {
                result.errors.push( 'Failed to retrieve group details' );
                return result;
            }

            // Check if security group
            result.isSecurityGroup = this.isSecurityGroup( groupDetails );
            if ( !result.isSecurityGroup ) {
                result.errors.push( 'Group is not a security group' );
            }

            // Check if active
            result.isActive = this.isGroupActive( groupDetails );
            if ( !result.isActive ) {
                result.errors.push( 'Group is deleted or inactive' );
            }

            // Check member count
            result.memberCount = await this.getGroupMemberCount( groupId );
            result.hasMembers = result.memberCount > 0;
            if ( !result.hasMembers ) {
                result.errors.push( 'Group has no members' );
            }

            // Check AWS assignment status
            result.isAssignedToAWS = await this.isGroupAssignedToAWS( groupId );

            // Overall validation
            result.isValid = result.exists && result.isSecurityGroup && result.isActive && result.hasMembers;

        } catch ( error ) {
            result.errors.push( `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Batch validate multiple groups
     */
    async validateGroups( groupIds: string[] ): Promise<Map<string, boolean>> {
        const results = new Map<string, boolean>();

        // Process groups in parallel for better performance
        const validationPromises = groupIds.map( async ( groupId ) => {
            try {
                const isValid = await this.validateGroup( groupId );
                return { groupId, isValid };
            } catch {
                return { groupId, isValid: false };
            }
        } );

        const validationResults = await Promise.all( validationPromises );

        for ( const { groupId, isValid } of validationResults ) {
            results.set( groupId, isValid );
        }

        return results;
    }
}
