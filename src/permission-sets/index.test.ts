// Tests for Permission Set Management
import { PermissionSetManager, PermissionSetTemplate, CustomPermissionSetRequest } from './index';
import { AWSClient } from '../clients/aws-client';
import { PermissionSet } from '../types';

// Mock the AWSClient
jest.mock( '../clients/aws-client' );

describe( 'PermissionSetManager', () => {
    let permissionSetManager: PermissionSetManager;
    let mockAWSClient: jest.Mocked<AWSClient>;

    beforeEach( () => {
        mockAWSClient = new AWSClient( {
            region: 'us-east-1',
            identityCenterInstanceArn: 'arn:aws:sso:::instance/test',
            identityStoreId: 'test-store-id'
        } ) as jest.Mocked<AWSClient>;

        permissionSetManager = new PermissionSetManager( mockAWSClient );
    } );

    describe( 'Template Management', () => {
        it( 'should provide predefined templates', () => {
            const templates = permissionSetManager.getAvailableTemplates();

            expect( templates.length ).toBeGreaterThan( 0 );
            expect( templates.some( t => t.name === 'ReadOnlyAccess' ) ).toBe( true );
            expect( templates.some( t => t.name === 'DeveloperAccess' ) ).toBe( true );
            expect( templates.some( t => t.name === 'AdministratorAccess' ) ).toBe( true );
        } );

        it( 'should get specific template by name', () => {
            const template = permissionSetManager.getTemplate( 'readonly' );

            expect( template ).toBeDefined();
            expect( template?.name ).toBe( 'ReadOnlyAccess' );
            expect( template?.managedPolicies ).toContain( 'arn:aws:iam::aws:policy/ReadOnlyAccess' );
        } );

        it( 'should return undefined for non-existent template', () => {
            const template = permissionSetManager.getTemplate( 'non-existent' );
            expect( template ).toBeUndefined();
        } );
    } );

    describe( 'Permission Set Creation from Template', () => {
        const mockPermissionSet: PermissionSet = {
            arn: 'arn:aws:sso:::permissionSet/test-ps',
            name: 'TestPermissionSet',
            description: 'Test permission set',
            sessionDuration: 'PT4H',
            managedPolicies: [ 'arn:aws:iam::aws:policy/ReadOnlyAccess' ],
            tags: {},
            accountAssignments: []
        };

        beforeEach( () => {
            mockAWSClient.createPermissionSet.mockResolvedValue( mockPermissionSet );
            mockAWSClient.attachManagedPolicyToPermissionSet.mockResolvedValue();
            mockAWSClient.putInlinePolicyToPermissionSet.mockResolvedValue();
        } );

        it( 'should create permission set from template', async () => {
            const result = await permissionSetManager.createFromTemplate( 'readonly' );

            expect( mockAWSClient.createPermissionSet ).toHaveBeenCalledWith(
                'ReadOnlyAccess',
                'Provides read-only access to AWS resources',
                'PT4H'
            );
            expect( mockAWSClient.attachManagedPolicyToPermissionSet ).toHaveBeenCalledWith(
                mockPermissionSet.arn,
                'arn:aws:iam::aws:policy/ReadOnlyAccess'
            );
            expect( result.arn ).toBe( mockPermissionSet.arn );
        } );

        it( 'should create permission set with customizations', async () => {
            const customizations = {
                name: 'CustomReadOnly',
                description: 'Custom read-only access',
                sessionDuration: 'PT2H'
            };

            await permissionSetManager.createFromTemplate( 'readonly', customizations );

            expect( mockAWSClient.createPermissionSet ).toHaveBeenCalledWith(
                'CustomReadOnly',
                'Custom read-only access',
                'PT2H'
            );
        } );

        it( 'should throw error for non-existent template', async () => {
            await expect(
                permissionSetManager.createFromTemplate( 'non-existent' )
            ).rejects.toThrow( "Template 'non-existent' not found" );
        } );
    } );

    describe( 'Custom Permission Set Creation', () => {
        const mockPermissionSet: PermissionSet = {
            arn: 'arn:aws:sso:::permissionSet/custom-ps',
            name: 'CustomPermissionSet',
            description: 'Custom permission set',
            sessionDuration: 'PT1H',
            managedPolicies: [],
            tags: {},
            accountAssignments: []
        };

        beforeEach( () => {
            mockAWSClient.createPermissionSet.mockResolvedValue( mockPermissionSet );
            mockAWSClient.attachManagedPolicyToPermissionSet.mockResolvedValue();
        } );

        it( 'should create custom permission set with minimal config', async () => {
            const request: CustomPermissionSetRequest = {
                name: 'CustomPS'
            };

            const result = await permissionSetManager.createCustomPermissionSet( request );

            expect( mockAWSClient.createPermissionSet ).toHaveBeenCalledWith(
                'CustomPS',
                'Custom permission set: CustomPS',
                'PT1H'
            );
            expect( result.arn ).toBe( mockPermissionSet.arn );
        } );

        it( 'should create custom permission set with full config', async () => {
            const request: CustomPermissionSetRequest = {
                name: 'FullCustomPS',
                description: 'Full custom permission set',
                sessionDuration: 'PT6H',
                managedPolicies: [ 'arn:aws:iam::aws:policy/ReadOnlyAccess' ],
                tags: { 'Environment': 'test' }
            };

            await permissionSetManager.createCustomPermissionSet( request );

            expect( mockAWSClient.createPermissionSet ).toHaveBeenCalledWith(
                'FullCustomPS',
                'Full custom permission set',
                'PT6H'
            );
            expect( mockAWSClient.attachManagedPolicyToPermissionSet ).toHaveBeenCalledWith(
                mockPermissionSet.arn,
                'arn:aws:iam::aws:policy/ReadOnlyAccess'
            );
        } );
    } );

    describe( 'Permission Set Validation', () => {
        it( 'should validate valid permission set config', async () => {
            const config: PermissionSetTemplate = {
                name: 'ValidPS',
                description: 'Valid permission set',
                sessionDuration: 'PT4H',
                managedPolicies: [ 'arn:aws:iam::aws:policy/ReadOnlyAccess' ],
                tags: {}
            };

            const result = await permissionSetManager.validatePermissionSetConfig( config );

            expect( result.isValid ).toBe( true );
            expect( result.errors ).toHaveLength( 0 );
        } );

        it( 'should reject invalid permission set name', async () => {
            const config: PermissionSetTemplate = {
                name: '', // Invalid: empty name
                description: 'Test',
                sessionDuration: 'PT1H',
                managedPolicies: [],
                tags: {}
            };

            const result = await permissionSetManager.validatePermissionSetConfig( config );

            expect( result.isValid ).toBe( false );
            expect( result.errors ).toContain( 'Permission set name is required' );
        } );

        it( 'should reject invalid session duration', async () => {
            const config: PermissionSetTemplate = {
                name: 'TestPS',
                description: 'Test',
                sessionDuration: 'invalid-duration',
                managedPolicies: [],
                tags: {}
            };

            const result = await permissionSetManager.validatePermissionSetConfig( config );

            expect( result.isValid ).toBe( false );
            expect( result.errors.some( e => e.includes( 'Invalid session duration format' ) ) ).toBe( true );
        } );

        it( 'should reject session duration outside valid range', async () => {
            const configTooShort: PermissionSetTemplate = {
                name: 'TestPS',
                description: 'Test',
                sessionDuration: 'PT10M', // Too short (< 15 minutes)
                managedPolicies: [],
                tags: {}
            };

            const resultTooShort = await permissionSetManager.validatePermissionSetConfig( configTooShort );
            expect( resultTooShort.isValid ).toBe( false );
            expect( resultTooShort.errors.some( e => e.includes( 'at least 15 minutes' ) ) ).toBe( true );

            const configTooLong: PermissionSetTemplate = {
                name: 'TestPS',
                description: 'Test',
                sessionDuration: 'PT13H', // Too long (> 12 hours)
                managedPolicies: [],
                tags: {}
            };

            const resultTooLong = await permissionSetManager.validatePermissionSetConfig( configTooLong );
            expect( resultTooLong.isValid ).toBe( false );
            expect( resultTooLong.errors.some( e => e.includes( 'cannot exceed 12 hours' ) ) ).toBe( true );
        } );

        it( 'should reject invalid policy ARN', async () => {
            const config: PermissionSetTemplate = {
                name: 'TestPS',
                description: 'Test',
                sessionDuration: 'PT1H',
                managedPolicies: [ 'invalid-arn' ],
                tags: {}
            };

            const result = await permissionSetManager.validatePermissionSetConfig( config );

            expect( result.isValid ).toBe( false );
            expect( result.errors.some( e => e.includes( 'Invalid managed policy ARN' ) ) ).toBe( true );
        } );

        it( 'should validate inline policy JSON', async () => {
            const configInvalidJson: PermissionSetTemplate = {
                name: 'TestPS',
                description: 'Test',
                sessionDuration: 'PT1H',
                managedPolicies: [],
                inlinePolicy: 'invalid-json',
                tags: {}
            };

            const result = await permissionSetManager.validatePermissionSetConfig( configInvalidJson );

            expect( result.isValid ).toBe( false );
            expect( result.errors.some( e => e.includes( 'Policy must be valid JSON' ) ) ).toBe( true );
        } );

        it( 'should warn about highly privileged policies', async () => {
            const config: PermissionSetTemplate = {
                name: 'AdminPS',
                description: 'Admin permission set',
                sessionDuration: 'PT1H',
                managedPolicies: [ 'arn:aws:iam::aws:policy/AdministratorAccess' ],
                tags: {}
            };

            const result = await permissionSetManager.validatePermissionSetConfig( config );

            expect( result.isValid ).toBe( true );
            expect( result.warnings.some( w => w.includes( 'highly privileged policies' ) ) ).toBe( true );
        } );

        it( 'should warn about empty permission set', async () => {
            const config: PermissionSetTemplate = {
                name: 'EmptyPS',
                description: 'Empty permission set',
                sessionDuration: 'PT1H',
                managedPolicies: [],
                tags: {}
            };

            const result = await permissionSetManager.validatePermissionSetConfig( config );

            expect( result.isValid ).toBe( true );
            expect( result.warnings.some( w => w.includes( 'no policies attached' ) ) ).toBe( true );
        } );
    } );

    describe( 'Template Recommendations', () => {
        it( 'should recommend admin template for admin groups', () => {
            const recommendations = permissionSetManager.getRecommendedTemplates( 'AWS-Administrators' );
            expect( recommendations ).toContain( 'admin' );
        } );

        it( 'should recommend developer templates for developer groups', () => {
            const recommendations = permissionSetManager.getRecommendedTemplates( 'Development-Team' );
            expect( recommendations ).toContain( 'developer' );
        } );

        it( 'should recommend readonly template for audit groups', () => {
            const recommendations = permissionSetManager.getRecommendedTemplates( 'Security-Auditors' );
            expect( recommendations ).toContain( 'readonly' );
            expect( recommendations ).toContain( 'security-auditor' );
        } );

        it( 'should recommend service-specific templates', () => {
            const s3Recommendations = permissionSetManager.getRecommendedTemplates( 'S3-Users' );
            expect( s3Recommendations ).toContain( 's3-access' );

            const ec2Recommendations = permissionSetManager.getRecommendedTemplates( 'EC2-Operators' );
            expect( ec2Recommendations ).toContain( 'ec2-access' );
        } );
    } );

    describe( 'Permission Set Existence Check', () => {
        it( 'should check if permission set exists', async () => {
            const existingPermissionSets: PermissionSet[] = [
                {
                    arn: 'arn:aws:sso:::permissionSet/existing',
                    name: 'ExistingPS',
                    description: 'Existing permission set',
                    sessionDuration: 'PT1H',
                    managedPolicies: [],
                    tags: {},
                    accountAssignments: []
                }
            ];

            mockAWSClient.listPermissionSets.mockResolvedValue( existingPermissionSets );

            const exists = await permissionSetManager.permissionSetExists( 'ExistingPS' );
            const notExists = await permissionSetManager.permissionSetExists( 'NonExistentPS' );

            expect( exists ).toBe( true );
            expect( notExists ).toBe( false );
        } );

        it( 'should generate unique permission set name', async () => {
            const existingPermissionSets: PermissionSet[] = [
                {
                    arn: 'arn:aws:sso:::permissionSet/test',
                    name: 'TestPS',
                    description: 'Test permission set',
                    sessionDuration: 'PT1H',
                    managedPolicies: [],
                    tags: {},
                    accountAssignments: []
                },
                {
                    arn: 'arn:aws:sso:::permissionSet/test-1',
                    name: 'TestPS-1',
                    description: 'Test permission set 1',
                    sessionDuration: 'PT1H',
                    managedPolicies: [],
                    tags: {},
                    accountAssignments: []
                }
            ];

            mockAWSClient.listPermissionSets.mockResolvedValue( existingPermissionSets );

            const uniqueName = await permissionSetManager.generateUniquePermissionSetName( 'TestPS' );
            expect( uniqueName ).toBe( 'TestPS-2' );
        } );
    } );
} );
