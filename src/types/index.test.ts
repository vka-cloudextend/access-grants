// Basic test to verify test setup
import { AzureGroup, PermissionSet } from './index';

describe( 'Type definitions', () => {
    it( 'should define AzureGroup interface correctly', () => {
        const group: AzureGroup = {
            id: 'test-id',
            displayName: 'Test Group',
            groupType: 'Security',
            memberCount: 5,
            isAssignedToAWS: false,
        };

        expect( group.id ).toBe( 'test-id' );
        expect( group.displayName ).toBe( 'Test Group' );
        expect( group.groupType ).toBe( 'Security' );
    } );

    it( 'should define PermissionSet interface correctly', () => {
        const permissionSet: PermissionSet = {
            arn: 'arn:aws:sso:::permissionSet/test',
            name: 'TestPermissionSet',
            sessionDuration: 'PT1H',
            managedPolicies: [ 'ReadOnlyAccess' ],
            tags: {},
            accountAssignments: [],
        };

        expect( permissionSet.arn ).toBe( 'arn:aws:sso:::permissionSet/test' );
        expect( permissionSet.name ).toBe( 'TestPermissionSet' );
        expect( permissionSet.managedPolicies ).toContain( 'ReadOnlyAccess' );
    } );
} );
