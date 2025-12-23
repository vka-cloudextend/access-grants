// Assignment Validator Tests
import { AssignmentValidator } from './index';
import { AzureClient } from '../clients/azure-client';
import { AWSClient } from '../clients/aws-client';
import { GroupAssignment } from '../types';

// Mock the clients
jest.mock( '../clients/azure-client' );
jest.mock( '../clients/aws-client' );

describe( 'AssignmentValidator', () => {
    let validator: AssignmentValidator;
    let mockAzureClient: jest.Mocked<AzureClient>;
    let mockAWSClient: jest.Mocked<AWSClient>;

    beforeEach( () => {
        mockAzureClient = new AzureClient( {
            tenantId: 'test-tenant',
            clientId: 'test-client',
            clientSecret: 'test-secret'
        } ) as jest.Mocked<AzureClient>;

        mockAWSClient = new AWSClient( {
            region: 'us-east-1',
            identityCenterInstanceArn: 'test-instance-arn',
            identityStoreId: 'test-identity-store'
        } ) as jest.Mocked<AWSClient>;

        validator = new AssignmentValidator( mockAzureClient, mockAWSClient );
    } );

    describe( 'validateAssignment', () => {
        it( 'should validate a valid assignment', async () => {
            const assignment: GroupAssignment = {
                azureGroupId: 'test-group-id',
                azureGroupName: 'Test Group',
                awsAccountId: '123456789012',
                permissionSetArn: 'arn:aws:sso:::permissionSet/test-ps',
                assignmentStatus: 'ACTIVE',
                createdDate: new Date()
            };

            // Mock successful validation responses
            mockAzureClient.validateGroupDetailed.mockResolvedValue( {
                isValid: true,
                exists: true,
                isSecurityGroup: true,
                isActive: true,
                hasMembers: true,
                memberCount: 5,
                isAssignedToAWS: true,
                errors: []
            } );

            mockAWSClient.checkGroupSynchronizationStatus.mockResolvedValue( {
                isSynced: true,
                awsGroupId: 'aws-group-id',
                lastSyncTime: new Date()
            } );

            mockAWSClient.listPermissionSets.mockResolvedValue( [ {
                arn: 'arn:aws:sso:::permissionSet/test-ps',
                name: 'TestPermissionSet',
                description: 'Test permission set',
                sessionDuration: 'PT1H',
                managedPolicies: [ 'arn:aws:iam::aws:policy/ReadOnlyAccess' ],
                inlinePolicy: undefined,
                tags: {},
                accountAssignments: []
            } ] );

            mockAWSClient.listAccountAssignments.mockResolvedValue( [ {
                accountId: '123456789012',
                principalId: 'test-group-id',
                principalType: 'GROUP',
                permissionSetArn: 'arn:aws:sso:::permissionSet/test-ps',
                status: 'PROVISIONED'
            } ] );

            mockAWSClient.getGroupDetails.mockResolvedValue( {
                displayName: 'Test Group',
                description: 'Test group description',
                memberCount: 5
            } );

            mockAWSClient.getAccountAssignmentsForAccount.mockResolvedValue( [ {
                accountId: '123456789012',
                principalId: 'aws-group-id',
                principalType: 'GROUP',
                permissionSetArn: 'arn:aws:sso:::permissionSet/test-ps',
                status: 'PROVISIONED'
            } ] );

            const result = await validator.validateAssignment( assignment );

            expect( result.isValid ).toBe( true );
            expect( result.errors ).toHaveLength( 0 );
            expect( result.details.azureGroup?.exists ).toBe( true );
            expect( result.details.synchronization?.isSynced ).toBe( true );
            expect( result.details.permissionSet?.exists ).toBe( true );
            expect( result.details.assignment?.isActive ).toBe( true );
        } );

        it( 'should detect invalid assignment with missing Azure group', async () => {
            const assignment: GroupAssignment = {
                azureGroupId: 'missing-group-id',
                azureGroupName: 'Missing Group',
                awsAccountId: '123456789012',
                permissionSetArn: 'arn:aws:sso:::permissionSet/test-ps',
                assignmentStatus: 'ACTIVE',
                createdDate: new Date()
            };

            // Mock Azure group not found
            mockAzureClient.validateGroupDetailed.mockResolvedValue( {
                isValid: false,
                exists: false,
                isSecurityGroup: false,
                isActive: false,
                hasMembers: false,
                memberCount: 0,
                isAssignedToAWS: false,
                errors: [ 'Group does not exist' ]
            } );

            const result = await validator.validateAssignment( assignment );

            expect( result.isValid ).toBe( false );
            expect( result.errors ).toContain( 'Azure group missing-group-id does not exist' );
        } );
    } );

    describe( 'testAssignmentFunctionality', () => {
        it( 'should test assignment functionality successfully', async () => {
            const assignment: GroupAssignment = {
                azureGroupId: 'test-group-id',
                azureGroupName: 'Test Group',
                awsAccountId: '123456789012',
                permissionSetArn: 'arn:aws:sso:::permissionSet/test-ps',
                assignmentStatus: 'ACTIVE',
                createdDate: new Date()
            };

            mockAWSClient.checkGroupSynchronizationStatus.mockResolvedValue( {
                isSynced: true,
                awsGroupId: 'aws-group-id',
                lastSyncTime: new Date()
            } );

            mockAWSClient.getGroupDetails.mockResolvedValue( {
                displayName: 'Test Group',
                description: 'Test group description',
                memberCount: 5
            } );

            mockAWSClient.getAccountAssignmentsForAccount.mockResolvedValue( [ {
                accountId: '123456789012',
                principalId: 'aws-group-id',
                principalType: 'GROUP',
                permissionSetArn: 'arn:aws:sso:::permissionSet/test-ps',
                status: 'PROVISIONED'
            } ] );

            mockAWSClient.listAccountAssignments.mockResolvedValue( [ {
                accountId: '123456789012',
                principalId: 'test-group-id',
                principalType: 'GROUP',
                permissionSetArn: 'arn:aws:sso:::permissionSet/test-ps',
                status: 'PROVISIONED'
            } ] );

            const result = await validator.testAssignmentFunctionality( assignment );

            expect( result.success ).toBe( true );
            expect( result.testResults.groupSynchronization ).toBe( true );
            expect( result.testResults.permissionInheritance ).toBe( true );
            expect( result.testResults.assignmentFunctionality ).toBe( true );
        } );
    } );

    describe( 'validateAssignments', () => {
        it( 'should validate multiple assignments', async () => {
            const assignments: GroupAssignment[] = [
                {
                    azureGroupId: 'group-1',
                    azureGroupName: 'Group 1',
                    awsAccountId: '123456789012',
                    permissionSetArn: 'arn:aws:sso:::permissionSet/ps-1',
                    assignmentStatus: 'ACTIVE',
                    createdDate: new Date()
                },
                {
                    azureGroupId: 'group-2',
                    azureGroupName: 'Group 2',
                    awsAccountId: '123456789012',
                    permissionSetArn: 'arn:aws:sso:::permissionSet/ps-2',
                    assignmentStatus: 'ACTIVE',
                    createdDate: new Date()
                }
            ];

            // Mock responses for both groups
            mockAzureClient.validateGroupDetailed
                .mockResolvedValueOnce( {
                    isValid: true,
                    exists: true,
                    isSecurityGroup: true,
                    isActive: true,
                    hasMembers: true,
                    memberCount: 3,
                    isAssignedToAWS: true,
                    errors: []
                } )
                .mockResolvedValueOnce( {
                    isValid: false,
                    exists: false,
                    isSecurityGroup: false,
                    isActive: false,
                    hasMembers: false,
                    memberCount: 0,
                    isAssignedToAWS: false,
                    errors: [ 'Group does not exist' ]
                } );

            mockAWSClient.checkGroupSynchronizationStatus
                .mockResolvedValue( {
                    isSynced: false
                } );

            mockAWSClient.listPermissionSets.mockResolvedValue( [] );
            mockAWSClient.listAccountAssignments.mockResolvedValue( [] );

            const results = await validator.validateAssignments( assignments );

            expect( results.size ).toBe( 2 );

            const result1 = results.get( 'group-1-123456789012-arn:aws:sso:::permissionSet/ps-1' );
            const result2 = results.get( 'group-2-123456789012-arn:aws:sso:::permissionSet/ps-2' );

            expect( result1?.details.azureGroup?.exists ).toBe( true );
            expect( result2?.details.azureGroup?.exists ).toBe( false );
        } );
    } );
} );
