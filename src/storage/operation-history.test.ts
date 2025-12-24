// Operation History Storage Tests
import * as fs from 'fs/promises';
import * as path from 'path';
import { OperationHistoryStorage } from './operation-history';
import { AssignmentOperation } from '../types';

// Mock fs and path modules for testing
jest.mock( 'fs/promises' );
jest.mock( 'fs' );
jest.mock( 'os', () => ( {
    homedir: () => '/mock/home'
} ) );

describe( 'OperationHistoryStorage', () => {
    let storage: OperationHistoryStorage;
    const mockFs = fs as jest.Mocked<typeof fs>;

    beforeEach( () => {
        jest.clearAllMocks();
        storage = new OperationHistoryStorage( {
            maxEntries: 100,
            retentionDays: 7,
            autoSave: false // Disable auto-save for testing
        } );
    } );

    describe( 'initialization', () => {
        it( 'should initialize with empty history when file does not exist', async () => {
            // Mock file not existing
            const mockExistsSync = require( 'fs' ).existsSync as jest.Mock;
            mockExistsSync.mockReturnValue( false );
            mockFs.mkdir.mockResolvedValue( undefined );

            await storage.initialize();

            expect( storage.isInitialized() ).toBe( true );
            const operations = await storage.getAllOperations();
            expect( operations ).toHaveLength( 0 );
        } );

        it( 'should load existing operations from file', async () => {
            const mockExistsSync = require( 'fs' ).existsSync as jest.Mock;
            mockExistsSync.mockReturnValue( true );
            mockFs.mkdir.mockResolvedValue( undefined );

            const mockOperations = [ {
                operationId: 'test-op-1',
                operationType: 'CREATE',
                assignments: [],
                status: 'COMPLETED',
                errors: [],
                startTime: '2023-01-01T00:00:00.000Z',
                endTime: '2023-01-01T00:01:00.000Z'
            } ];

            mockFs.readFile.mockResolvedValue( JSON.stringify( {
                version: '1.0',
                operations: mockOperations
            } ) );

            await storage.initialize();

            const operations = await storage.getAllOperations();
            expect( operations ).toHaveLength( 1 );
            expect( operations[ 0 ].operationId ).toBe( 'test-op-1' );
            expect( operations[ 0 ].startTime ).toBeInstanceOf( Date );
        } );
    } );

    describe( 'operation management', () => {
        beforeEach( async () => {
            const mockExistsSync = require( 'fs' ).existsSync as jest.Mock;
            mockExistsSync.mockReturnValue( false );
            mockFs.mkdir.mockResolvedValue( undefined );
            await storage.initialize();
        } );

        it( 'should add and retrieve operations', async () => {
            const operation: AssignmentOperation = {
                operationId: 'test-op-1',
                operationType: 'CREATE',
                assignments: [ {
                    azureGroupId: 'group-1',
                    azureGroupName: 'Test Group',
                    awsAccountId: '123456789012',
                    permissionSetArn: 'arn:aws:sso:::permissionSet/test',
                    assignmentStatus: 'ACTIVE',
                    createdDate: new Date()
                } ],
                status: 'COMPLETED',
                errors: [],
                startTime: new Date(),
                endTime: new Date()
            };

            await storage.addOperation( operation );

            const retrieved = await storage.getOperation( 'test-op-1' );
            expect( retrieved ).toBeDefined();
            expect( retrieved?.operationId ).toBe( 'test-op-1' );
            expect( retrieved?.operationType ).toBe( 'CREATE' );
        } );

        it( 'should filter operations by criteria', async () => {
            const operations: AssignmentOperation[] = [
                {
                    operationId: 'op-1',
                    operationType: 'CREATE',
                    assignments: [],
                    status: 'COMPLETED',
                    errors: [],
                    startTime: new Date( '2023-01-01' ),
                    endTime: new Date( '2023-01-01' )
                },
                {
                    operationId: 'op-2',
                    operationType: 'DELETE',
                    assignments: [],
                    status: 'FAILED',
                    errors: [],
                    startTime: new Date( '2023-01-02' ),
                    endTime: new Date( '2023-01-02' )
                }
            ];

            for ( const op of operations ) {
                await storage.addOperation( op );
            }

            const result = await storage.getOperations( {
                status: 'COMPLETED',
                limit: 10
            } );

            expect( result.operations ).toHaveLength( 1 );
            expect( result.operations[ 0 ].operationId ).toBe( 'op-1' );
            expect( result.total ).toBe( 1 );
        } );
    } );

    describe( 'cleanup', () => {
        beforeEach( async () => {
            const mockExistsSync = require( 'fs' ).existsSync as jest.Mock;
            mockExistsSync.mockReturnValue( false );
            mockFs.mkdir.mockResolvedValue( undefined );
            await storage.initialize();
        } );

        it( 'should remove old operations during cleanup', async () => {
            const oldOperation: AssignmentOperation = {
                operationId: 'old-op',
                operationType: 'CREATE',
                assignments: [],
                status: 'COMPLETED',
                errors: [],
                startTime: new Date( '2020-01-01' ), // Very old
                endTime: new Date( '2020-01-01' )
            };

            const newOperation: AssignmentOperation = {
                operationId: 'new-op',
                operationType: 'CREATE',
                assignments: [],
                status: 'COMPLETED',
                errors: [],
                startTime: new Date(), // Recent
                endTime: new Date()
            };

            await storage.addOperation( oldOperation );
            await storage.addOperation( newOperation );

            const deletedCount = await storage.cleanup();

            expect( deletedCount ).toBe( 1 );
            const remaining = await storage.getAllOperations();
            expect( remaining ).toHaveLength( 1 );
            expect( remaining[ 0 ].operationId ).toBe( 'new-op' );
        } );
    } );

    describe( 'statistics', () => {
        beforeEach( async () => {
            const mockExistsSync = require( 'fs' ).existsSync as jest.Mock;
            mockExistsSync.mockReturnValue( false );
            mockFs.mkdir.mockResolvedValue( undefined );
            mockFs.stat.mockResolvedValue( { size: 1024 } as any );
            await storage.initialize();
        } );

        it( 'should provide accurate statistics', async () => {
            const operations: AssignmentOperation[] = [
                {
                    operationId: 'op-1',
                    operationType: 'CREATE',
                    assignments: [],
                    status: 'COMPLETED',
                    errors: [],
                    startTime: new Date( '2023-01-01' ),
                    endTime: new Date( '2023-01-01' )
                },
                {
                    operationId: 'op-2',
                    operationType: 'DELETE',
                    assignments: [],
                    status: 'FAILED',
                    errors: [],
                    startTime: new Date( '2023-01-02' ),
                    endTime: new Date( '2023-01-02' )
                }
            ];

            for ( const op of operations ) {
                await storage.addOperation( op );
            }

            const stats = await storage.getStatistics();

            expect( stats.totalOperations ).toBe( 2 );
            expect( stats.operationsByType.CREATE ).toBe( 1 );
            expect( stats.operationsByType.DELETE ).toBe( 1 );
            expect( stats.operationsByStatus.COMPLETED ).toBe( 1 );
            expect( stats.operationsByStatus.FAILED ).toBe( 1 );
            expect( stats.filePath ).toBe( '/mock/home/.aws-ag/operation-history.json' );
        } );
    } );
} );
