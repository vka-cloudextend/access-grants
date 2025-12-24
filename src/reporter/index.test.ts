// Configuration Reporter Tests
import { ConfigurationReporter } from './index';
import { AzureClient } from '../clients/azure-client';
import { AWSClient } from '../clients/aws-client';
import { AssignmentOperation } from '../types';
import { OperationHistoryStorage } from '../storage/operation-history';

// Mock the clients and storage
jest.mock( '../clients/azure-client' );
jest.mock( '../clients/aws-client' );
jest.mock( '../storage/operation-history' );

describe( 'ConfigurationReporter', () => {
    let reporter: ConfigurationReporter;
    let mockAzureClient: jest.Mocked<AzureClient>;
    let mockAWSClient: jest.Mocked<AWSClient>;
    let mockOperationHistoryStorage: jest.Mocked<OperationHistoryStorage>;

    beforeEach( () => {
        jest.clearAllMocks();

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

        // Mock the OperationHistoryStorage
        mockOperationHistoryStorage = {
            initialize: jest.fn().mockResolvedValue( undefined ),
            addOperation: jest.fn().mockResolvedValue( undefined ),
            getOperation: jest.fn().mockResolvedValue( undefined ),
            getAllOperations: jest.fn().mockResolvedValue( [] ),
            getOperations: jest.fn().mockResolvedValue( { operations: [], total: 0, hasMore: false } ),
            deleteOperation: jest.fn().mockResolvedValue( true ),
            cleanup: jest.fn().mockResolvedValue( 0 ),
            getStatistics: jest.fn().mockResolvedValue( {
                totalOperations: 0,
                operationsByStatus: {},
                operationsByType: {},
                filePath: '/mock/path',
                fileExists: false
            } ),
            exportToFile: jest.fn().mockResolvedValue( undefined ),
            importFromFile: jest.fn().mockResolvedValue( 0 ),
            clear: jest.fn().mockResolvedValue( undefined ),
            saveToFile: jest.fn().mockResolvedValue( undefined ),
            getHistoryFilePath: jest.fn().mockReturnValue( '/mock/path' ),
            isInitialized: jest.fn().mockReturnValue( true )
        } as unknown as jest.Mocked<OperationHistoryStorage>;

        reporter = new ConfigurationReporter( mockAzureClient, mockAWSClient, mockOperationHistoryStorage );
    } );

    describe( 'generateAssignmentSummary', () => {
        it( 'should generate assignment summary', async () => {
            mockAWSClient.listAccountAssignments.mockResolvedValue( [
                {
                    accountId: '123456789012',
                    principalId: 'group-1',
                    principalType: 'GROUP',
                    permissionSetArn: 'arn:aws:sso:::permissionSet/ps-1',
                    status: 'PROVISIONED'
                },
                {
                    accountId: '123456789012',
                    principalId: 'group-2',
                    principalType: 'GROUP',
                    permissionSetArn: 'arn:aws:sso:::permissionSet/ps-2',
                    status: 'FAILED'
                }
            ] );

            // Mock the storage getOperations call
            mockOperationHistoryStorage.getOperations.mockResolvedValue( {
                operations: [],
                total: 0,
                hasMore: false
            } );

            const summary = await reporter.generateAssignmentSummary();

            expect( summary.totalAssignments ).toBe( 2 );
            expect( summary.activeAssignments ).toBe( 1 );
            expect( summary.failedAssignments ).toBe( 1 );
            expect( summary.assignmentsByAccount[ '123456789012' ] ).toBe( 2 );
            expect( mockOperationHistoryStorage.getOperations ).toHaveBeenCalledWith( { limit: 10 } );
        }, 10000 ); // 10 second timeout
    } );

    describe( 'logOperation', () => {
        it( 'should log operation successfully', async () => {
            const operation: AssignmentOperation = {
                operationId: 'test-op-1',
                operationType: 'CREATE',
                assignments: [],
                status: 'COMPLETED',
                errors: [],
                startTime: new Date(),
                endTime: new Date()
            };

            await expect( reporter.logOperation( operation ) ).resolves.not.toThrow();
            expect( mockOperationHistoryStorage.addOperation ).toHaveBeenCalledWith( operation );
        }, 10000 ); // 10 second timeout
    } );
} );
