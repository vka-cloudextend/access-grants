// Basic tests for AWS Client
import { AWSClient } from './aws-client';

describe( 'AWSClient', () => {
    let awsClient: AWSClient;

    beforeEach( () => {
        awsClient = new AWSClient( {
            region: 'us-east-1',
            identityCenterInstanceArn: 'arn:aws:sso:::instance/test-instance',
            identityStoreId: 'test-identity-store-id'
        } );
    } );

    it( 'should initialize with correct configuration', () => {
        expect( awsClient ).toBeDefined();
        expect( awsClient[ 'config' ].region ).toBe( 'us-east-1' );
        expect( awsClient[ 'config' ].identityCenterInstanceArn ).toBe( 'arn:aws:sso:::instance/test-instance' );
        expect( awsClient[ 'config' ].identityStoreId ).toBe( 'test-identity-store-id' );
    } );

    it( 'should have all required methods', () => {
        expect( typeof awsClient.listPermissionSets ).toBe( 'function' );
        expect( typeof awsClient.createPermissionSet ).toBe( 'function' );
        expect( typeof awsClient.assignGroupToAccount ).toBe( 'function' );
        expect( typeof awsClient.deleteAccountAssignment ).toBe( 'function' );
        expect( typeof awsClient.deletePermissionSet ).toBe( 'function' );
        expect( typeof awsClient.validateAssignmentDeletionStatus ).toBe( 'function' );
        expect( typeof awsClient.listAccountAssignments ).toBe( 'function' );
        expect( typeof awsClient.listOrganizationAccounts ).toBe( 'function' );
        expect( typeof awsClient.getAccountAssignmentsForAccount ).toBe( 'function' );
        expect( typeof awsClient.checkGroupSynchronizationStatus ).toBe( 'function' );
        expect( typeof awsClient.validateAssignmentStatus ).toBe( 'function' );
        expect( typeof awsClient.getGroupDetails ).toBe( 'function' );
        expect( typeof awsClient.attachManagedPolicyToPermissionSet ).toBe( 'function' );
        expect( typeof awsClient.putInlinePolicyToPermissionSet ).toBe( 'function' );
    } );

    // Note: Integration tests would require actual AWS credentials and resources
    // These tests only verify the client structure and basic functionality
} );
