// Configuration Reporter Tests
import { ConfigurationReporter } from './index';
import { AzureClient } from '../clients/azure-client';
import { AWSClient } from '../clients/aws-client';
import { AssignmentOperation } from '../types';

// Mock the clients
jest.mock( '../clients/azure-client' );
jest.mock( '../clients/aws-client' );

describe( 'ConfigurationReporter', () => {
    let reporter: ConfigurationReporter;
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

        reporter = new ConfigurationReporter( mockAzureClient, mockAWSClient );
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

            const summary = await reporter.generateAssignmentSummary();

            expect( summary.totalAssignments ).toBe( 2 );
            expect( summary.activeAssignments ).toBe( 1 );
            expect( summary.failedAssignments ).toBe( 1 );
            expect( summary.assignmentsByAccount[ '123456789012' ] ).toBe( 2 );
        } );
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
        } );
    } );
} );
