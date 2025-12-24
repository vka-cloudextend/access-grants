// AWS IAM Identity Center Client
import {
    DescribeGroupCommand,
    IdentitystoreClient,
    ListGroupMembershipsCommand,
    ListGroupsCommand
} from '@aws-sdk/client-identitystore';
import {
    ListAccountsCommand,
    OrganizationsClient
} from '@aws-sdk/client-organizations';
import {
    AttachManagedPolicyToPermissionSetCommand,
    CreateAccountAssignmentCommand,
    CreatePermissionSetCommand,
    DeleteAccountAssignmentCommand,
    DeletePermissionSetCommand,
    DescribeAccountAssignmentCreationStatusCommand,
    DescribeAccountAssignmentDeletionStatusCommand,
    DescribePermissionSetCommand,
    ListAccountAssignmentsCommand,
    ListPermissionSetsCommand,
    ProvisionPermissionSetCommand,
    PutInlinePolicyToPermissionSetCommand,
    SSOAdminClient
} from '@aws-sdk/client-sso-admin';
import { AccountAssignment, PermissionSet } from '../types';

export class AWSClient {
    private ssoAdminClient: SSOAdminClient;
    private identityStoreClient: IdentitystoreClient;
    private organizationsClient: OrganizationsClient;

    constructor( private config: { region: string; identityCenterInstanceArn: string; identityStoreId: string; profile?: string } ) {
        const clientConfig = {
            region: config.region,
            ...( config.profile && { profile: config.profile } )
        };

        this.ssoAdminClient = new SSOAdminClient( clientConfig );
        this.identityStoreClient = new IdentitystoreClient( clientConfig );
        this.organizationsClient = new OrganizationsClient( clientConfig );
    }

    async listPermissionSets(): Promise<PermissionSet[]> {
        try {
            const command = new ListPermissionSetsCommand( {
                InstanceArn: this.config.identityCenterInstanceArn
            } );

            const response = await this.ssoAdminClient.send( command );
            const permissionSets: PermissionSet[] = [];

            if ( response.PermissionSets ) {
                for ( const permissionSetArn of response.PermissionSets ) {
                    const detailsCommand = new DescribePermissionSetCommand( {
                        InstanceArn: this.config.identityCenterInstanceArn,
                        PermissionSetArn: permissionSetArn
                    } );

                    const detailsResponse = await this.ssoAdminClient.send( detailsCommand );

                    if ( detailsResponse.PermissionSet ) {
                        const ps = detailsResponse.PermissionSet;

                        permissionSets.push( {
                            arn: permissionSetArn,
                            name: ps.Name || '',
                            description: ps.Description,
                            sessionDuration: ps.SessionDuration || 'PT1H',
                            managedPolicies: [], // Will be populated separately if needed
                            inlinePolicy: undefined, // Will be populated separately if needed
                            tags: {},
                            accountAssignments: []
                        } );
                    }
                }
            }

            return permissionSets;
        } catch ( error ) {
            throw new Error( `Failed to list permission sets: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    async createPermissionSet( name: string, description?: string, sessionDuration?: string ): Promise<PermissionSet> {
        try {
            const command = new CreatePermissionSetCommand( {
                InstanceArn: this.config.identityCenterInstanceArn,
                Name: name,
                Description: description,
                SessionDuration: sessionDuration || 'PT1H',
                Tags: [
                    {
                        Key: 'CreatedBy',
                        Value: 'aws-ag-tool'
                    },
                    {
                        Key: 'CreatedAt',
                        Value: new Date().toISOString()
                    }
                ]
            } );

            const response = await this.ssoAdminClient.send( command );

            if ( !response.PermissionSet?.PermissionSetArn ) {
                throw new Error( 'Permission set creation failed - no ARN returned' );
            }

            // Provision the permission set to make it available for assignments
            await this.provisionPermissionSet( response.PermissionSet.PermissionSetArn );

            return {
                arn: response.PermissionSet.PermissionSetArn,
                name: response.PermissionSet.Name || name,
                description: response.PermissionSet.Description || description,
                sessionDuration: response.PermissionSet.SessionDuration || 'PT1H',
                managedPolicies: [],
                inlinePolicy: undefined,
                tags: {
                    'CreatedBy': 'aws-ag-tool',
                    'CreatedAt': new Date().toISOString()
                },
                accountAssignments: []
            };
        } catch ( error ) {
            throw new Error( `Failed to create permission set: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    async assignGroupToAccount( groupId: string, accountId: string, permissionSetArn: string ): Promise<AccountAssignment> {
        try {
            const command = new CreateAccountAssignmentCommand( {
                InstanceArn: this.config.identityCenterInstanceArn,
                TargetId: accountId,
                TargetType: 'AWS_ACCOUNT',
                PermissionSetArn: permissionSetArn,
                PrincipalType: 'GROUP',
                PrincipalId: groupId
            } );

            const response = await this.ssoAdminClient.send( command );

            if ( !response.AccountAssignmentCreationStatus?.RequestId ) {
                throw new Error( 'Account assignment creation failed - no request ID returned' );
            }

            // Return the assignment details
            return {
                accountId: accountId,
                principalId: groupId,
                principalType: 'GROUP',
                permissionSetArn: permissionSetArn,
                status: 'IN_PROGRESS' // Will be updated when provisioning completes
            };
        } catch ( error ) {
            throw new Error( `Failed to assign group to account: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    async attachManagedPolicyToPermissionSet( permissionSetArn: string, managedPolicyArn: string ): Promise<void> {
        try {
            const command = new AttachManagedPolicyToPermissionSetCommand( {
                InstanceArn: this.config.identityCenterInstanceArn,
                PermissionSetArn: permissionSetArn,
                ManagedPolicyArn: managedPolicyArn
            } );

            await this.ssoAdminClient.send( command );

            // Provision the permission set to apply the policy changes
            await this.provisionPermissionSet( permissionSetArn );
        } catch ( error ) {
            throw new Error( `Failed to attach managed policy: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    async putInlinePolicyToPermissionSet( permissionSetArn: string, inlinePolicy: string ): Promise<void> {
        try {
            const command = new PutInlinePolicyToPermissionSetCommand( {
                InstanceArn: this.config.identityCenterInstanceArn,
                PermissionSetArn: permissionSetArn,
                InlinePolicy: inlinePolicy
            } );

            await this.ssoAdminClient.send( command );

            // Provision the permission set to apply the policy changes
            await this.provisionPermissionSet( permissionSetArn );
        } catch ( error ) {
            throw new Error( `Failed to put inline policy: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    private async provisionPermissionSet( permissionSetArn: string ): Promise<void> {
        try {
            const command = new ProvisionPermissionSetCommand( {
                InstanceArn: this.config.identityCenterInstanceArn,
                PermissionSetArn: permissionSetArn,
                TargetType: 'ALL_PROVISIONED_ACCOUNTS'
            } );

            await this.ssoAdminClient.send( command );
        } catch ( error ) {
            throw new Error( `Failed to provision permission set: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    async listAccountAssignments(): Promise<AccountAssignment[]> {
        try {
            // Get all permission sets first
            const permissionSets = await this.listPermissionSets();
            const allAssignments: AccountAssignment[] = [];

            // For each permission set, get its account assignments
            for ( const permissionSet of permissionSets ) {
                const assignments = await this.getAccountAssignmentsForPermissionSet( permissionSet.arn );
                allAssignments.push( ...assignments );
            }

            return allAssignments;
        } catch ( error ) {
            throw new Error( `Failed to list account assignments: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    async checkGroupSynchronizationStatus( azureGroupId: string ): Promise<{ isSynced: boolean; awsGroupId?: string; lastSyncTime?: Date }> {
        try {
            // List groups in Identity Store to find the corresponding AWS group
            const command = new ListGroupsCommand( {
                IdentityStoreId: this.config.identityStoreId
            } );

            const response = await this.identityStoreClient.send( command );

            if ( response.Groups ) {
                for ( const group of response.Groups ) {
                    // Check if this AWS group corresponds to the Azure group
                    // This typically involves checking external IDs or display names
                    if ( group.ExternalIds ) {
                        for ( const externalId of group.ExternalIds ) {
                            if ( externalId.Id === azureGroupId && externalId.Issuer === 'AzureAD' ) {
                                return {
                                    isSynced: true,
                                    awsGroupId: group.GroupId,
                                    lastSyncTime: new Date() // AWS doesn't provide last sync time directly
                                };
                            }
                        }
                    }
                }
            }

            return { isSynced: false };
        } catch ( error ) {
            throw new Error( `Failed to check group synchronization status: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    async validateAssignmentStatus( assignmentRequestId: string ): Promise<{ status: 'PROVISIONED' | 'IN_PROGRESS' | 'FAILED'; failureReason?: string }> {
        try {
            const command = new DescribeAccountAssignmentCreationStatusCommand( {
                InstanceArn: this.config.identityCenterInstanceArn,
                AccountAssignmentCreationRequestId: assignmentRequestId
            } );

            const response = await this.ssoAdminClient.send( command );

            if ( response.AccountAssignmentCreationStatus ) {
                const status = response.AccountAssignmentCreationStatus.Status;
                const failureReason = response.AccountAssignmentCreationStatus.FailureReason;

                switch ( status ) {
                    case 'SUCCEEDED':
                        return { status: 'PROVISIONED' };
                    case 'IN_PROGRESS':
                        return { status: 'IN_PROGRESS' };
                    case 'FAILED':
                        return { status: 'FAILED', failureReason };
                    default:
                        return { status: 'IN_PROGRESS' };
                }
            }

            return { status: 'IN_PROGRESS' };
        } catch ( error ) {
            throw new Error( `Failed to validate assignment status: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    async getGroupDetails( awsGroupId: string ): Promise<{ displayName: string; description?: string; memberCount: number }> {
        try {
            const groupCommand = new DescribeGroupCommand( {
                IdentityStoreId: this.config.identityStoreId,
                GroupId: awsGroupId
            } );

            const groupResponse = await this.identityStoreClient.send( groupCommand );

            // Get member count
            const membersCommand = new ListGroupMembershipsCommand( {
                IdentityStoreId: this.config.identityStoreId,
                GroupId: awsGroupId
            } );

            const membersResponse = await this.identityStoreClient.send( membersCommand );
            const memberCount = membersResponse.GroupMemberships?.length || 0;

            return {
                displayName: groupResponse.DisplayName || '',
                description: groupResponse.Description,
                memberCount
            };
        } catch ( error ) {
            throw new Error( `Failed to get group details: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    async deleteAccountAssignment( groupId: string, accountId: string, permissionSetArn: string ): Promise<{ requestId: string }> {
        try {
            const command = new DeleteAccountAssignmentCommand( {
                InstanceArn: this.config.identityCenterInstanceArn,
                TargetId: accountId,
                TargetType: 'AWS_ACCOUNT',
                PermissionSetArn: permissionSetArn,
                PrincipalType: 'GROUP',
                PrincipalId: groupId
            } );

            const response = await this.ssoAdminClient.send( command );

            if ( !response.AccountAssignmentDeletionStatus?.RequestId ) {
                throw new Error( 'Account assignment deletion failed - no request ID returned' );
            }

            return {
                requestId: response.AccountAssignmentDeletionStatus.RequestId
            };
        } catch ( error ) {
            throw new Error( `Failed to delete account assignment: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    async deletePermissionSet( permissionSetArn: string ): Promise<void> {
        try {
            const command = new DeletePermissionSetCommand( {
                InstanceArn: this.config.identityCenterInstanceArn,
                PermissionSetArn: permissionSetArn
            } );

            await this.ssoAdminClient.send( command );
        } catch ( error ) {
            throw new Error( `Failed to delete permission set: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    async validateAssignmentDeletionStatus( deletionRequestId: string ): Promise<{ status: 'SUCCEEDED' | 'IN_PROGRESS' | 'FAILED'; failureReason?: string }> {
        try {
            const command = new DescribeAccountAssignmentDeletionStatusCommand( {
                InstanceArn: this.config.identityCenterInstanceArn,
                AccountAssignmentDeletionRequestId: deletionRequestId
            } );

            const response = await this.ssoAdminClient.send( command );

            if ( response.AccountAssignmentDeletionStatus ) {
                const status = response.AccountAssignmentDeletionStatus.Status;
                const failureReason = response.AccountAssignmentDeletionStatus.FailureReason;

                return {
                    status: status || 'IN_PROGRESS',
                    failureReason
                };
            }

            return { status: 'IN_PROGRESS' };
        } catch ( error ) {
            throw new Error( `Failed to validate assignment deletion status: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    async listOrganizationAccounts(): Promise<{ accountId: string; accountName: string; status: string }[]> {
        try {
            const command = new ListAccountsCommand( {} );
            const response = await this.organizationsClient.send( command );

            if ( !response.Accounts ) {
                return [];
            }

            return response.Accounts.map( account => ( {
                accountId: account.Id || '',
                accountName: account.Name || '',
                status: account.Status || 'UNKNOWN'
            } ) ).filter( account => account.accountId && account.status === 'ACTIVE' );
        } catch ( error ) {
            throw new Error( `Failed to list organization accounts: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    async getAccountAssignmentsForAccount( accountId: string ): Promise<AccountAssignment[]> {
        try {
            const assignments: AccountAssignment[] = [];

            // Get all permission sets
            const permissionSets = await this.listPermissionSets();

            // For each permission set, check assignments for this account
            for ( const permissionSet of permissionSets ) {
                try {
                    const command = new ListAccountAssignmentsCommand( {
                        InstanceArn: this.config.identityCenterInstanceArn,
                        AccountId: accountId,
                        PermissionSetArn: permissionSet.arn
                    } );

                    const response = await this.ssoAdminClient.send( command );

                    if ( response.AccountAssignments ) {
                        for ( const assignment of response.AccountAssignments ) {
                            assignments.push( {
                                accountId: assignment.AccountId || accountId,
                                principalId: assignment.PrincipalId || '',
                                principalType: assignment.PrincipalType as 'USER' | 'GROUP' || 'GROUP',
                                permissionSetArn: assignment.PermissionSetArn || permissionSet.arn,
                                status: 'PROVISIONED'
                            } );
                        }
                    }
                } catch ( permissionSetError ) {
                    // Log error but continue with other permission sets
                    console.warn( `Failed to get assignments for permission set ${permissionSet.arn} in account ${accountId}: ${permissionSetError instanceof Error ? permissionSetError.message : 'Unknown error'}` );
                }
            }

            return assignments;
        } catch ( error ) {
            throw new Error( `Failed to get account assignments for account ${accountId}: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    private async getAccountAssignmentsForPermissionSet( permissionSetArn: string ): Promise<AccountAssignment[]> {
        try {
            const assignments: AccountAssignment[] = [];

            // Get all accounts in the organization
            const accounts = await this.listOrganizationAccounts();

            // For each account, check if there are assignments for this permission set
            for ( const account of accounts ) {
                try {
                    const command = new ListAccountAssignmentsCommand( {
                        InstanceArn: this.config.identityCenterInstanceArn,
                        AccountId: account.accountId,
                        PermissionSetArn: permissionSetArn
                    } );

                    const response = await this.ssoAdminClient.send( command );

                    if ( response.AccountAssignments ) {
                        for ( const assignment of response.AccountAssignments ) {
                            assignments.push( {
                                accountId: assignment.AccountId || account.accountId,
                                principalId: assignment.PrincipalId || '',
                                principalType: assignment.PrincipalType as 'USER' | 'GROUP' || 'GROUP',
                                permissionSetArn: assignment.PermissionSetArn || permissionSetArn,
                                status: 'PROVISIONED' // Assignments returned by ListAccountAssignments are provisioned
                            } );
                        }
                    }
                } catch ( accountError ) {
                    // Log error but continue with other accounts
                    console.warn( `Failed to get assignments for account ${account.accountId}: ${accountError instanceof Error ? accountError.message : 'Unknown error'}` );
                }
            }

            return assignments;
        } catch ( error ) {
            throw new Error( `Failed to get account assignments for permission set: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }
}
