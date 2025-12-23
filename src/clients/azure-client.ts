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

interface GraphUser {
    id?: string;
    displayName?: string;
    userPrincipalName?: string;
    mail?: string;
    accountEnabled?: boolean;
    deletedDateTime?: string;
}

export class AzureClient {
    private graphClient: Client;
    private config: AzureConfig;
    private msalClient: ConfidentialClientApplication;
    private awsClient?: any; // Optional AWS client for cross-reference functionality

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
     * Set AWS client for enhanced cross-reference functionality
     * This allows the Azure client to perform more accurate AWS assignment checks
     */
    setAWSClient( awsClient: any ): void {
        this.awsClient = awsClient;
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
     */
    async isGroupAssignedToAWS( groupId: string ): Promise<boolean> {
        try {
            // Use enhanced check if AWS client is available
            if ( this.awsClient ) {
                const result = await this.isGroupAssignedToAWSWithClient( groupId, this.awsClient );
                return result.isAssigned;
            }

            // Fall back to basic enterprise app assignment check
            const response = await this.graphClient
                .api( `/groups/${groupId}/appRoleAssignments` )
                .get();

            const assignments = response.value || [];

            // Look for assignments that might be AWS-related
            // This is a heuristic approach until we have full AWS integration
            for ( const assignment of assignments ) {
                if ( assignment.resourceDisplayName &&
                    ( assignment.resourceDisplayName.toLowerCase().includes( 'aws' ) ||
                        assignment.resourceDisplayName.toLowerCase().includes( 'identity center' ) ||
                        assignment.resourceDisplayName.toLowerCase().includes( 'sso' ) ) ) {
                    return true;
                }
            }

            return false;
        } catch ( error ) {
            // If we can't check assignments, assume not assigned to be safe
            console.warn( `Failed to check AWS assignment status for group ${groupId}: ${error instanceof Error ? error.message : 'Unknown error'}` );
            return false;
        }
    }

    /**
     * Enhanced AWS cross-reference check using AWS client
     * This method should be called when AWS client is available for more accurate checking
     */
    async isGroupAssignedToAWSWithClient( groupId: string, awsClient?: any ): Promise<{
        isAssigned: boolean;
        assignments: Array<{
            accountId: string;
            permissionSetArn: string;
            status: string;
        }>;
        syncStatus: {
            isSynced: boolean;
            awsGroupId?: string;
        };
    }> {
        const result = {
            isAssigned: false,
            assignments: [] as Array<{
                accountId: string;
                permissionSetArn: string;
                status: string;
            }>,
            syncStatus: {
                isSynced: false,
                awsGroupId: undefined as string | undefined
            }
        };

        try {
            if ( !awsClient ) {
                // Fall back to basic check
                result.isAssigned = await this.isGroupAssignedToAWS( groupId );
                return result;
            }

            // Check if group is synced to AWS Identity Store
            const syncStatus = await awsClient.checkGroupSynchronizationStatus( groupId );
            result.syncStatus = syncStatus;

            if ( syncStatus.isSynced && syncStatus.awsGroupId ) {
                // Get all account assignments for this group
                const allAssignments = await awsClient.listAccountAssignments();
                const groupAssignments = allAssignments.filter( ( assignment: any ) =>
                    assignment.principalId === syncStatus.awsGroupId || assignment.principalId === groupId
                );

                result.assignments = groupAssignments.map( ( assignment: any ) => ( {
                    accountId: assignment.accountId,
                    permissionSetArn: assignment.permissionSetArn,
                    status: assignment.status
                } ) );

                result.isAssigned = result.assignments.length > 0;
            }

        } catch ( error ) {
            console.warn( `Failed to perform enhanced AWS cross-reference for group ${groupId}: ${error instanceof Error ? error.message : 'Unknown error'}` );
            // Fall back to basic check
            result.isAssigned = await this.isGroupAssignedToAWS( groupId );
        }

        return result;
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
     * Validate if a user exists in Azure AD and is active
     * Implements Requirements 1.3: Validate email addresses and user status
     */
    async validateUser( emailOrId: string ): Promise<{
        isValid: boolean;
        exists: boolean;
        isActive: boolean;
        user?: {
            id: string;
            displayName: string;
            userPrincipalName: string;
            mail?: string;
        };
        errors: string[];
    }> {
        const result = {
            isValid: false,
            exists: false,
            isActive: false,
            user: undefined as any,
            errors: [] as string[]
        };

        try {
            // Validate email format if it looks like an email
            if ( emailOrId.includes( '@' ) && !this.isValidEmail( emailOrId ) ) {
                result.errors.push( 'Invalid email address format' );
                return result;
            }

            // Try to find user by email or ID
            let user: GraphUser | null = null;

            if ( emailOrId.includes( '@' ) ) {
                // Search by email/userPrincipalName
                user = await this.getUserByEmail( emailOrId );
            } else {
                // Search by ID
                user = await this.getUserById( emailOrId );
            }

            if ( !user ) {
                result.errors.push( 'User not found in Azure AD' );
                return result;
            }

            result.exists = true;

            // Check if user is active (not deleted and account enabled)
            result.isActive = user.accountEnabled === true && !user.deletedDateTime;
            if ( !result.isActive ) {
                if ( user.deletedDateTime ) {
                    result.errors.push( 'User account is deleted' );
                }
                if ( user.accountEnabled === false ) {
                    result.errors.push( 'User account is disabled' );
                }
            }

            // Set user details if valid
            if ( user.id && user.displayName && user.userPrincipalName ) {
                result.user = {
                    id: user.id,
                    displayName: user.displayName,
                    userPrincipalName: user.userPrincipalName,
                    mail: user.mail
                };
            }

            result.isValid = result.exists && result.isActive && !!result.user;

        } catch ( error ) {
            result.errors.push( `User validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Get user by email address or userPrincipalName
     */
    private async getUserByEmail( email: string ): Promise<GraphUser | null> {
        try {
            const response = await this.graphClient
                .api( '/users' )
                .filter( `mail eq '${email}' or userPrincipalName eq '${email}'` )
                .select( 'id,displayName,userPrincipalName,mail,accountEnabled,deletedDateTime' )
                .get();

            const users = response.value || [];
            return users.length > 0 ? users[ 0 ] : null;
        } catch {
            return null;
        }
    }

    /**
     * Get user by ID
     */
    private async getUserById( userId: string ): Promise<GraphUser | null> {
        try {
            const response = await this.graphClient
                .api( `/users/${userId}` )
                .select( 'id,displayName,userPrincipalName,mail,accountEnabled,deletedDateTime' )
                .get();

            return response;
        } catch {
            return null;
        }
    }

    /**
     * Validate email address format
     */
    private isValidEmail( email: string ): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test( email );
    }

    /**
     * Batch validate multiple users
     */
    async validateUsers( emailsOrIds: string[] ): Promise<Map<string, boolean>> {
        const results = new Map<string, boolean>();

        // Process users in parallel for better performance
        const validationPromises = emailsOrIds.map( async ( emailOrId ) => {
            try {
                const validation = await this.validateUser( emailOrId );
                return { emailOrId, isValid: validation.isValid };
            } catch {
                return { emailOrId, isValid: false };
            }
        } );

        const validationResults = await Promise.all( validationPromises );

        for ( const { emailOrId, isValid } of validationResults ) {
            results.set( emailOrId, isValid );
        }

        return results;
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

    /**
     * Create a new Azure AD security group
     * Implements Requirements 1.1: Create Azure AD security groups
     */
    async createSecurityGroup( displayName: string, description?: string, mailNickname?: string ): Promise<{
        success: boolean;
        groupId?: string;
        group?: {
            id: string;
            displayName: string;
            description?: string;
            mailNickname: string;
        };
        errors: string[];
    }> {
        const result = {
            success: false,
            groupId: undefined as string | undefined,
            group: undefined as any,
            errors: [] as string[]
        };

        try {
            // Validate input
            if ( !displayName || displayName.trim().length === 0 ) {
                result.errors.push( 'Display name is required' );
                return result;
            }

            // Generate mail nickname if not provided
            const generatedMailNickname = mailNickname || this.generateMailNickname( displayName );

            // Create the group
            const groupData = {
                displayName: displayName.trim(),
                description: description?.trim(),
                mailNickname: generatedMailNickname,
                securityEnabled: true,
                mailEnabled: false,
                groupTypes: [] // Empty array for security groups
            };

            const response = await this.graphClient
                .api( '/groups' )
                .post( groupData );

            if ( response && response.id ) {
                result.success = true;
                result.groupId = response.id;
                result.group = {
                    id: response.id,
                    displayName: response.displayName,
                    description: response.description,
                    mailNickname: response.mailNickname
                };
            } else {
                result.errors.push( 'Group creation failed - no group ID returned' );
            }

        } catch ( error ) {
            result.errors.push( `Group creation failed: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Add an owner to an Azure AD group
     * Implements Requirements 1.1: Manage group ownership
     */
    async addGroupOwner( groupId: string, userIdOrEmail: string ): Promise<{
        success: boolean;
        errors: string[];
    }> {
        const result = {
            success: false,
            errors: [] as string[]
        };

        try {
            // Validate user exists first
            const userValidation = await this.validateUser( userIdOrEmail );
            if ( !userValidation.isValid || !userValidation.user ) {
                result.errors.push( `User validation failed: ${userValidation.errors.join( ', ' )}` );
                return result;
            }

            // Add user as owner
            const ownerData = {
                '@odata.id': `https://graph.microsoft.com/v1.0/users/${userValidation.user.id}`
            };

            await this.graphClient
                .api( `/groups/${groupId}/owners/$ref` )
                .post( ownerData );

            result.success = true;

        } catch ( error ) {
            result.errors.push( `Failed to add group owner: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Add a member to an Azure AD group
     * Implements Requirements 1.1: Manage group membership
     */
    async addGroupMember( groupId: string, userIdOrEmail: string ): Promise<{
        success: boolean;
        errors: string[];
    }> {
        const result = {
            success: false,
            errors: [] as string[]
        };

        try {
            // Validate user exists first
            const userValidation = await this.validateUser( userIdOrEmail );
            if ( !userValidation.isValid || !userValidation.user ) {
                result.errors.push( `User validation failed: ${userValidation.errors.join( ', ' )}` );
                return result;
            }

            // Add user as member
            const memberData = {
                '@odata.id': `https://graph.microsoft.com/v1.0/users/${userValidation.user.id}`
            };

            await this.graphClient
                .api( `/groups/${groupId}/members/$ref` )
                .post( memberData );

            result.success = true;

        } catch ( error ) {
            result.errors.push( `Failed to add group member: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Add multiple members to a group in batch
     */
    async addGroupMembers( groupId: string, userIdsOrEmails: string[] ): Promise<{
        success: boolean;
        successfulAdditions: string[];
        failedAdditions: { user: string; error: string }[];
        errors: string[];
    }> {
        const result = {
            success: false,
            successfulAdditions: [] as string[],
            failedAdditions: [] as { user: string; error: string }[],
            errors: [] as string[]
        };

        try {
            // Process members in parallel for better performance
            const memberPromises = userIdsOrEmails.map( async ( userIdOrEmail ) => {
                try {
                    const addResult = await this.addGroupMember( groupId, userIdOrEmail );
                    return { userIdOrEmail, success: addResult.success, errors: addResult.errors };
                } catch ( error ) {
                    return {
                        userIdOrEmail,
                        success: false,
                        errors: [ error instanceof Error ? error.message : 'Unknown error' ]
                    };
                }
            } );

            const memberResults = await Promise.all( memberPromises );

            for ( const memberResult of memberResults ) {
                if ( memberResult.success ) {
                    result.successfulAdditions.push( memberResult.userIdOrEmail );
                } else {
                    result.failedAdditions.push( {
                        user: memberResult.userIdOrEmail,
                        error: memberResult.errors.join( ', ' )
                    } );
                }
            }

            result.success = result.successfulAdditions.length > 0;

        } catch ( error ) {
            result.errors.push( `Batch member addition failed: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Generate a mail nickname from display name
     */
    private generateMailNickname( displayName: string ): string {
        // Remove special characters and spaces, convert to lowercase
        return displayName
            .toLowerCase()
            .replace( /[^a-z0-9]/g, '' )
            .substring( 0, 64 ); // Azure AD limit for mail nickname
    }

    /**
     * Assign a group to an enterprise application
     * Implements Requirements 1.2: Enterprise application integration
     */
    async assignGroupToEnterpriseApp( groupId: string, enterpriseAppId: string, roleId?: string ): Promise<{
        success: boolean;
        assignmentId?: string;
        errors: string[];
    }> {
        const result = {
            success: false,
            assignmentId: undefined as string | undefined,
            errors: [] as string[]
        };

        try {
            // Validate group exists first
            const groupExists = await this.groupExists( groupId );
            if ( !groupExists ) {
                result.errors.push( 'Group does not exist or is not accessible' );
                return result;
            }

            // Get default role if not specified
            let appRoleId = roleId;
            if ( !appRoleId ) {
                const defaultRole = await this.getDefaultAppRole( enterpriseAppId );
                if ( !defaultRole ) {
                    result.errors.push( 'No default role found for enterprise application' );
                    return result;
                }
                appRoleId = defaultRole.id;
            }

            // Create the app role assignment
            const assignmentData = {
                principalId: groupId,
                resourceId: enterpriseAppId,
                appRoleId: appRoleId
            };

            const response = await this.graphClient
                .api( `/groups/${groupId}/appRoleAssignments` )
                .post( assignmentData );

            if ( response && response.id ) {
                result.success = true;
                result.assignmentId = response.id;
            } else {
                result.errors.push( 'Enterprise app assignment failed - no assignment ID returned' );
            }

        } catch ( error ) {
            result.errors.push( `Failed to assign group to enterprise app: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Trigger on-demand provisioning for a group
     * Implements Requirements 1.3: Provisioning management
     */
    async triggerProvisionOnDemand( groupId: string, enterpriseAppId: string ): Promise<{
        success: boolean;
        provisioningJobId?: string;
        errors: string[];
    }> {
        const result = {
            success: false,
            provisioningJobId: undefined as string | undefined,
            errors: [] as string[]
        };

        try {
            // Validate group exists first
            const groupExists = await this.groupExists( groupId );
            if ( !groupExists ) {
                result.errors.push( 'Group does not exist or is not accessible' );
                return result;
            }

            // Trigger provisioning on demand
            const provisioningData = {
                parameters: [
                    {
                        subjects: [
                            {
                                objectId: groupId,
                                objectTypeName: 'Group'
                            }
                        ],
                        ruleId: 'CreateGroup'
                    }
                ]
            };

            const response = await this.graphClient
                .api( `/servicePrincipals/${enterpriseAppId}/synchronization/jobs/{jobId}/provisionOnDemand` )
                .post( provisioningData );

            if ( response ) {
                result.success = true;
                result.provisioningJobId = response.id || 'unknown';
            } else {
                result.errors.push( 'Provisioning trigger failed - no response received' );
            }

        } catch ( error ) {
            // On-demand provisioning might not be available for all apps
            result.errors.push( `Failed to trigger on-demand provisioning: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Get provisioning status for a group
     * Implements Requirements 1.3: Provisioning status monitoring
     */
    async getProvisioningStatus( groupId: string, enterpriseAppId: string ): Promise<{
        isProvisioned: boolean;
        status: 'NotProvisioned' | 'Provisioning' | 'Provisioned' | 'Failed' | 'Unknown';
        lastProvisioningTime?: Date;
        errors: string[];
        details?: {
            targetId?: string;
            targetDisplayName?: string;
            action?: string;
        };
    }> {
        const result = {
            isProvisioned: false,
            status: 'Unknown' as 'NotProvisioned' | 'Provisioning' | 'Provisioned' | 'Failed' | 'Unknown',
            lastProvisioningTime: undefined as Date | undefined,
            errors: [] as string[],
            details: undefined as any
        };

        try {
            // Check if group is assigned to the enterprise app
            const isAssigned = await this.isGroupAssignedToEnterpriseApp( groupId, enterpriseAppId );
            if ( !isAssigned ) {
                result.status = 'NotProvisioned';
                result.errors.push( 'Group is not assigned to the enterprise application' );
                return result;
            }

            // Get provisioning logs for the group
            const provisioningLogs = await this.getProvisioningLogs( groupId, enterpriseAppId );

            if ( provisioningLogs.length === 0 ) {
                result.status = 'NotProvisioned';
                return result;
            }

            // Get the most recent provisioning log
            const latestLog = provisioningLogs[ 0 ]; // Assuming logs are sorted by date

            result.lastProvisioningTime = latestLog.activityDateTime ? new Date( latestLog.activityDateTime ) : undefined;

            // Determine status based on the latest log
            if ( latestLog.provisioningStatusInfo?.status ) {
                switch ( latestLog.provisioningStatusInfo.status.toLowerCase() ) {
                    case 'success':
                        result.status = 'Provisioned';
                        result.isProvisioned = true;
                        break;
                    case 'failure':
                        result.status = 'Failed';
                        result.errors.push( latestLog.provisioningStatusInfo.errorInformation?.errorDetails || 'Provisioning failed' );
                        break;
                    case 'skipped':
                        result.status = 'NotProvisioned';
                        break;
                    default:
                        result.status = 'Provisioning';
                }
            }

            // Set details if available
            if ( latestLog.targetIdentity ) {
                result.details = {
                    targetId: latestLog.targetIdentity.id,
                    targetDisplayName: latestLog.targetIdentity.displayName,
                    action: latestLog.provisioningAction
                };
            }

        } catch ( error ) {
            result.errors.push( `Failed to get provisioning status: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Check if a group is assigned to an enterprise application
     */
    private async isGroupAssignedToEnterpriseApp( groupId: string, enterpriseAppId: string ): Promise<boolean> {
        try {
            const response = await this.graphClient
                .api( `/groups/${groupId}/appRoleAssignments` )
                .filter( `resourceId eq '${enterpriseAppId}'` )
                .get();

            return response.value && response.value.length > 0;
        } catch {
            return false;
        }
    }

    /**
     * Get the default app role for an enterprise application
     */
    private async getDefaultAppRole( enterpriseAppId: string ): Promise<{ id: string; displayName: string } | null> {
        try {
            const response = await this.graphClient
                .api( `/servicePrincipals/${enterpriseAppId}` )
                .select( 'appRoles' )
                .get();

            const appRoles = response.appRoles || [];

            // Look for default role (usually has value "User" or is the first role)
            const defaultRole = appRoles.find( ( role: any ) =>
                role.value === 'User' || role.isDefault === true
            ) || appRoles[ 0 ];

            return defaultRole ? { id: defaultRole.id, displayName: defaultRole.displayName } : null;
        } catch {
            return null;
        }
    }

    /**
     * Get provisioning logs for a specific group and enterprise app
     */
    private async getProvisioningLogs( groupId: string, enterpriseAppId: string ): Promise<any[]> {
        try {
            const response = await this.graphClient
                .api( '/auditLogs/provisioning' )
                .filter( `targetResources/any(t: t/id eq '${groupId}') and servicePrincipal/id eq '${enterpriseAppId}'` )
                .orderby( 'activityDateTime desc' )
                .top( 10 )
                .get();

            return response.value || [];
        } catch {
            return [];
        }
    }

    // Rollback Methods for Requirements 7.3

    /**
     * Delete an Azure AD security group
     * Used for rollback operations when group creation needs to be undone
     * Implements Requirements 7.3: Rollback capabilities
     */
    async deleteGroup( groupId: string ): Promise<{
        success: boolean;
        errors: string[];
    }> {
        const result = {
            success: false,
            errors: [] as string[]
        };

        try {
            // Validate group exists first
            const groupExists = await this.groupExists( groupId );
            if ( !groupExists ) {
                result.errors.push( 'Group does not exist or is not accessible' );
                return result;
            }

            // Delete the group
            await this.graphClient
                .api( `/groups/${groupId}` )
                .delete();

            result.success = true;

        } catch ( error ) {
            result.errors.push( `Failed to delete group: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Remove a group's assignment from an enterprise application
     * Used for rollback operations when enterprise app assignment needs to be undone
     * Implements Requirements 7.3: Rollback capabilities
     */
    async removeGroupFromEnterpriseApp( groupId: string, enterpriseAppId: string ): Promise<{
        success: boolean;
        removedAssignments: string[];
        errors: string[];
    }> {
        const result = {
            success: false,
            removedAssignments: [] as string[],
            errors: [] as string[]
        };

        try {
            // Get all app role assignments for the group to this enterprise app
            const response = await this.graphClient
                .api( `/groups/${groupId}/appRoleAssignments` )
                .filter( `resourceId eq '${enterpriseAppId}'` )
                .get();

            const assignments = response.value || [];

            if ( assignments.length === 0 ) {
                result.errors.push( 'No assignments found for this group and enterprise application' );
                return result;
            }

            // Remove each assignment
            for ( const assignment of assignments ) {
                try {
                    await this.graphClient
                        .api( `/groups/${groupId}/appRoleAssignments/${assignment.id}` )
                        .delete();

                    result.removedAssignments.push( assignment.id );
                } catch ( error ) {
                    result.errors.push( `Failed to remove assignment ${assignment.id}: ${error instanceof Error ? error.message : 'Unknown error'}` );
                }
            }

            result.success = result.removedAssignments.length > 0;

        } catch ( error ) {
            result.errors.push( `Failed to remove group from enterprise app: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Remove a specific app role assignment by assignment ID
     * Used for more precise rollback operations
     */
    async removeAppRoleAssignment( groupId: string, assignmentId: string ): Promise<{
        success: boolean;
        errors: string[];
    }> {
        const result = {
            success: false,
            errors: [] as string[]
        };

        try {
            await this.graphClient
                .api( `/groups/${groupId}/appRoleAssignments/${assignmentId}` )
                .delete();

            result.success = true;

        } catch ( error ) {
            result.errors.push( `Failed to remove app role assignment: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Remove a user from a group (for rollback of member additions)
     */
    async removeGroupMember( groupId: string, userId: string ): Promise<{
        success: boolean;
        errors: string[];
    }> {
        const result = {
            success: false,
            errors: [] as string[]
        };

        try {
            await this.graphClient
                .api( `/groups/${groupId}/members/${userId}/$ref` )
                .delete();

            result.success = true;

        } catch ( error ) {
            result.errors.push( `Failed to remove group member: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }

    /**
     * Remove an owner from a group (for rollback of owner additions)
     */
    async removeGroupOwner( groupId: string, userId: string ): Promise<{
        success: boolean;
        errors: string[];
    }> {
        const result = {
            success: false,
            errors: [] as string[]
        };

        try {
            await this.graphClient
                .api( `/groups/${groupId}/owners/${userId}/$ref` )
                .delete();

            result.success = true;

        } catch ( error ) {
            result.errors.push( `Failed to remove group owner: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }

        return result;
    }
}
