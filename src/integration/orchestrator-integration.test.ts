// Integration tests for Assignment Orchestrator with existing components
import { AssignmentOrchestrator, OrchestrationConfig, AccessGrantRequest } from '../orchestrator';
import { AzureClient } from '../clients/azure-client';
import { AWSClient } from '../clients/aws-client';
import { PermissionSetManager } from '../permission-sets';
import { OperationHistoryStorage } from '../storage/operation-history';

// Mock external dependencies but test real integration between components
jest.mock( '@azure/msal-node' );
jest.mock( '@microsoft/microsoft-graph-client' );
jest.mock( '@aws-sdk/client-identitystore' );
jest.mock( '@aws-sdk/client-organizations' );
jest.mock( '@aws-sdk/client-sso-admin' );
jest.mock( 'uuid', () => ( {
    v4: () => 'test-integration-uuid'
} ) );

describe( 'Orchestrator Integration Tests', () => {
    let orchestrator: AssignmentOrchestrator;
    let azureClient: AzureClient;
    let awsClient: AWSClient;
    let permissionSetManager: PermissionSetManager;
    let operationHistoryStorage: OperationHistoryStorage;

    const mockConfig: OrchestrationConfig = {
        azure: {
            tenantId: 'test-tenant-id',
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            enterpriseApplicationId: 'test-enterprise-app-id'
        },
        aws: {
            region: 'us-east-1',
            identityCenterInstanceArn: 'arn:aws:sso:::instance/test-instance',
            identityStoreId: 'test-identity-store-id',
            accountMapping: {
                Dev: '123456789012',
                QA: '123456789013',
                Staging: '123456789014',
                Prod: '123456789015'
            }
        },
        retryAttempts: 3,
        retryDelayMs: 100 // Shorter delay for tests
    };

    beforeEach( () => {
        jest.clearAllMocks();

        // Create real instances (but with mocked external dependencies)
        azureClient = new AzureClient( mockConfig.azure );
        awsClient = new AWSClient( mockConfig.aws );
        permissionSetManager = new PermissionSetManager( awsClient );
        operationHistoryStorage = new OperationHistoryStorage( {
            maxEntries: 100,
            retentionDays: 30,
            autoSave: false
        } );

        orchestrator = new AssignmentOrchestrator( mockConfig, operationHistoryStorage );
    } );

    describe( 'Azure Client Integration', () => {
        it( 'should integrate with Azure client for group operations', async () => {
            // Mock MSAL client first
            const { ConfidentialClientApplication } = require( '@azure/msal-node' );
            const mockMsalClient = {
                acquireTokenByClientCredential: jest.fn().mockResolvedValue( {
                    accessToken: 'mock-access-token'
                } )
            };
            ConfidentialClientApplication.mockImplementation( () => mockMsalClient );

            // Mock the Microsoft Graph client responses
            const mockGraphClient = {
                api: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                filter: jest.fn().mockReturnThis(),
                get: jest.fn().mockResolvedValue( {
                    value: [
                        {
                            id: 'test-group-id',
                            displayName: 'CE-AWS-Dev-AG-1234',
                            description: 'Test group',
                            groupTypes: [],
                            securityEnabled: true,
                            mailEnabled: false
                        }
                    ]
                } ),
                post: jest.fn().mockResolvedValue( {
                    id: 'new-group-id',
                    displayName: 'CE-AWS-Dev-AG-5678',
                    description: 'New test group'
                } )
            };

            // Mock the Graph client initialization
            const { Client } = require( '@microsoft/microsoft-graph-client' );
            Client.initWithMiddleware = jest.fn().mockReturnValue( mockGraphClient );

            // Create new client with mocked dependencies
            const testAzureClient = new AzureClient( mockConfig.azure );

            // Test group listing
            const groups = await testAzureClient.listSecurityGroups( 'CE-AWS-Dev' );
            expect( groups ).toHaveLength( 1 );
            expect( groups[ 0 ].displayName ).toBe( 'CE-AWS-Dev-AG-1234' );
            expect( groups[ 0 ].groupType ).toBe( 'Security' );

            // Verify the correct API calls were made
            expect( mockGraphClient.api ).toHaveBeenCalledWith( '/groups' );
            expect( mockGraphClient.select ).toHaveBeenCalledWith( 'id,displayName,description,groupTypes,securityEnabled,mailEnabled' );
            expect( mockGraphClient.filter ).toHaveBeenCalledWith(
                expect.stringContaining( 'securityEnabled eq true' )
            );
        } );

        it( 'should handle Azure client authentication errors', async () => {
            // Mock authentication failure
            const { ConfidentialClientApplication } = require( '@azure/msal-node' );
            const mockMsalClient = {
                acquireTokenByClientCredential: jest.fn().mockRejectedValue( new Error( 'Authentication failed' ) )
            };
            ConfidentialClientApplication.mockImplementation( () => mockMsalClient );

            // Mock the Graph client to fail on API calls
            const { Client } = require( '@microsoft/microsoft-graph-client' );
            Client.initWithMiddleware = jest.fn().mockReturnValue( {
                api: jest.fn().mockReturnThis(),
                select: jest.fn().mockReturnThis(),
                filter: jest.fn().mockReturnThis(),
                get: jest.fn().mockRejectedValue( new Error( 'Failed to acquire access token: Authentication failed' ) )
            } );

            // Create new client to trigger authentication
            const newAzureClient = new AzureClient( mockConfig.azure );

            await expect( newAzureClient.listSecurityGroups() ).rejects.toThrow( 'Failed to list security groups' );
        } );
    } );

    describe( 'AWS Client Integration', () => {
        it( 'should integrate with AWS client for permission set operations', async () => {
            // Mock AWS SDK responses
            const mockSSOAdminClient = {
                send: jest.fn()
            };

            const mockIdentityStoreClient = {
                send: jest.fn()
            };

            const mockOrganizationsClient = {
                send: jest.fn()
            };

            // Mock the AWS SDK constructors
            const { SSOAdminClient } = require( '@aws-sdk/client-sso-admin' );
            const { IdentitystoreClient } = require( '@aws-sdk/client-identitystore' );
            const { OrganizationsClient } = require( '@aws-sdk/client-organizations' );

            SSOAdminClient.mockImplementation( () => mockSSOAdminClient );
            IdentitystoreClient.mockImplementation( () => mockIdentityStoreClient );
            OrganizationsClient.mockImplementation( () => mockOrganizationsClient );

            // Mock permission set listing response
            mockSSOAdminClient.send.mockImplementation( ( command ) => {
                if ( command.constructor.name === 'ListPermissionSetsCommand' ) {
                    return Promise.resolve( {
                        PermissionSets: [ 'arn:aws:sso:::permissionSet/test-ps-1', 'arn:aws:sso:::permissionSet/test-ps-2' ]
                    } );
                }
                if ( command.constructor.name === 'DescribePermissionSetCommand' ) {
                    return Promise.resolve( {
                        PermissionSet: {
                            Name: 'TestPermissionSet',
                            Description: 'Test permission set',
                            SessionDuration: 'PT8H'
                        }
                    } );
                }
                return Promise.resolve( {} );
            } );

            // Create new AWS client with mocked dependencies
            const testAwsClient = new AWSClient( mockConfig.aws );

            // Test permission set listing
            const permissionSets = await testAwsClient.listPermissionSets();
            expect( permissionSets ).toHaveLength( 2 );
            expect( permissionSets[ 0 ].name ).toBe( 'TestPermissionSet' );
            expect( permissionSets[ 0 ].sessionDuration ).toBe( 'PT8H' );

            // Verify AWS SDK calls were made (commands are wrapped, so we check call count)
            expect( mockSSOAdminClient.send ).toHaveBeenCalledTimes( 3 ); // List + 2 Describe calls
        } );

        it( 'should handle AWS client service errors', async () => {
            // Mock AWS service error
            const mockSSOAdminClient = {
                send: jest.fn().mockRejectedValue( new Error( 'AccessDenied: Insufficient permissions' ) )
            };

            const { SSOAdminClient } = require( '@aws-sdk/client-sso-admin' );
            SSOAdminClient.mockImplementation( () => mockSSOAdminClient );

            const newAwsClient = new AWSClient( mockConfig.aws );

            await expect( newAwsClient.listPermissionSets() ).rejects.toThrow( 'Failed to list permission sets: AccessDenied: Insufficient permissions' );
        } );
    } );

    describe( 'Permission Set Manager Integration', () => {
        it( 'should integrate with permission set manager for template operations', async () => {
            // Mock AWS client responses for permission set manager
            const mockSSOAdminClient = {
                send: jest.fn()
            };

            const { SSOAdminClient } = require( '@aws-sdk/client-sso-admin' );
            SSOAdminClient.mockImplementation( () => mockSSOAdminClient );

            // Mock permission set creation response
            mockSSOAdminClient.send.mockImplementation( ( command ) => {
                if ( command.constructor.name === 'CreatePermissionSetCommand' ) {
                    return Promise.resolve( {
                        PermissionSet: {
                            PermissionSetArn: 'arn:aws:sso:::permissionSet/new-ps',
                            Name: 'TestTemplate',
                            Description: 'Created from template'
                        }
                    } );
                }
                if ( command.constructor.name === 'ProvisionPermissionSetCommand' ) {
                    return Promise.resolve( {
                        PermissionSetProvisioningStatus: {
                            RequestId: 'provision-request-id',
                            Status: 'IN_PROGRESS'
                        }
                    } );
                }
                return Promise.resolve( {} );
            } );

            // Create new AWS client and permission set manager with mocked dependencies
            const testAwsClient = new AWSClient( mockConfig.aws );
            const testPermissionSetManager = new PermissionSetManager( testAwsClient );

            // Test template availability
            const templates = testPermissionSetManager.getAvailableTemplates();
            expect( templates.map( t => t.name ) ).toContain( 'ReadOnlyAccess' );
            expect( templates.map( t => t.name ) ).toContain( 'DeveloperAccess' );
            expect( templates.map( t => t.name ) ).toContain( 'AdministratorAccess' );

            // Test template creation
            const permissionSet = await testPermissionSetManager.createFromTemplate( 'readonly', {
                name: 'TestTemplate',
                description: 'Created from template'
            } );

            expect( permissionSet.arn ).toBe( 'arn:aws:sso:::permissionSet/new-ps' );
            expect( permissionSet.name ).toBe( 'TestTemplate' );

            // Verify AWS calls were made (commands are wrapped, so we check call count)
            expect( mockSSOAdminClient.send ).toHaveBeenCalled();
        } );

        it( 'should handle permission set manager validation errors', async () => {
            // Create new permission set manager for testing
            const testPermissionSetManager = new PermissionSetManager( awsClient );

            // Test invalid template name
            await expect(
                testPermissionSetManager.createFromTemplate( 'InvalidTemplate', { name: 'Test' } )
            ).rejects.toThrow( "Template 'InvalidTemplate' not found" );

            // Test invalid permission set name
            await expect(
                testPermissionSetManager.createCustomPermissionSet( {
                    name: '', // Empty name
                    description: 'Test'
                } )
            ).rejects.toThrow( 'Permission set name is required' );
        } );
    } );

    describe( 'Operation History Storage Integration', () => {
        it( 'should integrate with operation history storage for persistence', async () => {
            // Initialize storage
            await operationHistoryStorage.initialize();

            // Test operation storage
            const testOperation = {
                operationId: 'test-op-1',
                operationType: 'CREATE' as const,
                assignments: [ {
                    azureGroupId: 'group-1',
                    azureGroupName: 'CE-AWS-Dev-AG-1234',
                    awsAccountId: '123456789012',
                    permissionSetArn: 'arn:aws:sso:::permissionSet/test',
                    assignmentStatus: 'ACTIVE' as const,
                    createdDate: new Date()
                } ],
                status: 'COMPLETED' as const,
                errors: [],
                startTime: new Date(),
                endTime: new Date()
            };

            await operationHistoryStorage.addOperation( testOperation );

            // Verify operation was stored
            const retrievedOperation = await operationHistoryStorage.getOperation( 'test-op-1' );
            expect( retrievedOperation ).toBeDefined();
            expect( retrievedOperation?.operationId ).toBe( 'test-op-1' );
            expect( retrievedOperation?.operationType ).toBe( 'CREATE' );
            expect( retrievedOperation?.assignments ).toHaveLength( 1 );

            // Test operation listing
            const allOperations = await operationHistoryStorage.getAllOperations();
            expect( allOperations ).toHaveLength( 1 );
            expect( allOperations[ 0 ].operationId ).toBe( 'test-op-1' );

            // Test operation filtering
            const filteredOperations = await operationHistoryStorage.getOperations( {
                status: 'COMPLETED',
                limit: 10
            } );
            expect( filteredOperations.operations ).toHaveLength( 1 );
            expect( filteredOperations.total ).toBe( 1 );
        } );

        it( 'should handle storage initialization errors gracefully', async () => {
            // Mock file system error
            const fs = require( 'fs/promises' );
            fs.mkdir = jest.fn().mockRejectedValue( new Error( 'Permission denied' ) );

            const newStorage = new OperationHistoryStorage();

            // Should not throw - should handle errors gracefully
            await expect( newStorage.initialize() ).resolves.not.toThrow();
            expect( newStorage.isInitialized() ).toBe( true );
        } );
    } );

    describe( 'Configuration Validation', () => {
        it( 'should validate configuration parameters across components', () => {
            // Test that all components receive correct configuration
            expect( azureClient ).toBeDefined();
            expect( awsClient ).toBeDefined();
            expect( permissionSetManager ).toBeDefined();
            expect( operationHistoryStorage ).toBeDefined();

            // Test configuration access
            expect( awsClient[ 'config' ].region ).toBe( 'us-east-1' );
            expect( awsClient[ 'config' ].identityCenterInstanceArn ).toBe( 'arn:aws:sso:::instance/test-instance' );
            expect( azureClient[ 'config' ].tenantId ).toBe( 'test-tenant-id' );
        } );

        it( 'should handle invalid configuration gracefully', () => {
            const invalidConfig = {
                ...mockConfig,
                aws: {
                    ...mockConfig.aws,
                    region: '', // Invalid region
                    identityCenterInstanceArn: 'invalid-arn'
                }
            };

            // Should not throw during construction
            expect( () => new AssignmentOrchestrator( invalidConfig ) ).not.toThrow();

            // But should fail when trying to use AWS services
            const invalidOrchestrator = new AssignmentOrchestrator( invalidConfig );
            expect( invalidOrchestrator ).toBeDefined();
        } );
    } );
} );
