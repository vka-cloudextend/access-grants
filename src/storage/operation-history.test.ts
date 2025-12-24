// Operation History Storage Tests
import * as fs from 'fs/promises';
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
    const mockExistsSync = require( 'fs' ).existsSync as jest.Mock;

    beforeEach( () => {
        jest.clearAllMocks();

        // Reset all mocks to default behavior
        mockExistsSync.mockReturnValue( false );
        mockFs.mkdir.mockResolvedValue( undefined );
        mockFs.readFile.mockResolvedValue( '{"operations": []}' );
        mockFs.writeFile.mockResolvedValue( undefined );
        mockFs.stat.mockResolvedValue( { size: 1024 } as any );

        storage = new OperationHistoryStorage( {
            maxEntries: 10,
            retentionDays: 1,
            autoSave: false
        } );
    } );

    describe( 'constructor and basic properties', () => {
        it( 'should create storage instance with correct file path', () => {
            expect( storage ).toBeDefined();
            expect( storage.getHistoryFilePath() ).toBe( '/mock/home/.aws-ag/operation-history.json' );
        } );

        it( 'should not be initialized initially', () => {
            expect( storage.isInitialized() ).toBe( false );
        } );
    } );

    describe( 'initialization', () => {
        it( 'should initialize successfully when file does not exist', async () => {
            mockExistsSync.mockReturnValue( false );

            await storage.initialize();

            expect( storage.isInitialized() ).toBe( true );
            expect( mockFs.mkdir ).toHaveBeenCalledWith( '/mock/home/.aws-ag', { recursive: true } );
        } );

        it( 'should load existing operations from file', async () => {
            mockExistsSync.mockReturnValue( true );
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

            expect( mockFs.readFile ).toHaveBeenCalledWith( '/mock/home/.aws-ag/operation-history.json', 'utf8' );
            expect( storage.isInitialized() ).toBe( true );
        } );

        it( 'should handle initialization errors gracefully', async () => {
            mockExistsSync.mockReturnValue( false );
            mockFs.mkdir.mockRejectedValue( new Error( 'Permission denied' ) );

            await expect( storage.initialize() ).resolves.not.toThrow();
            expect( storage.isInitialized() ).toBe( true );
        } );
    } );

    describe( 'operation management', () => {
        beforeEach( async () => {
            mockExistsSync.mockReturnValue( false );
            await storage.initialize();
        } );

        it( 'should add operation without auto-save', async () => {
            const operation: AssignmentOperation = {
                operationId: 'test-op-1',
                operationType: 'CREATE',
                assignments: [],
                status: 'COMPLETED',
                errors: [],
                startTime: new Date(),
                endTime: new Date()
            };

            await storage.addOperation( operation );

            // Should not call writeFile since autoSave is false
            expect( mockFs.writeFile ).not.toHaveBeenCalled();
        } );

        it( 'should retrieve added operation', async () => {
            const operation: AssignmentOperation = {
                operationId: 'test-op-1',
                operationType: 'CREATE',
                assignments: [],
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

        it( 'should get all operations', async () => {
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

            const allOps = await storage.getAllOperations();
            expect( allOps ).toHaveLength( 2 );
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

        it( 'should delete operations', async () => {
            const operation: AssignmentOperation = {
                operationId: 'test-op-1',
                operationType: 'CREATE',
                assignments: [],
                status: 'COMPLETED',
                errors: [],
                startTime: new Date(),
                endTime: new Date()
            };

            await storage.addOperation( operation );
            const deleted = await storage.deleteOperation( 'test-op-1' );

            expect( deleted ).toBe( true );
            const retrieved = await storage.getOperation( 'test-op-1' );
            expect( retrieved ).toBeUndefined();
        } );
    } );

    describe( 'file operations', () => {
        beforeEach( async () => {
            mockExistsSync.mockReturnValue( false );
            await storage.initialize();
        } );

        it( 'should save to file when explicitly called', async () => {
            await storage.saveToFile();

            expect( mockFs.writeFile ).toHaveBeenCalledWith(
                '/mock/home/.aws-ag/operation-history.json',
                expect.stringContaining( '"version": "1.0"' ),
                'utf8'
            );
        } );

        it( 'should auto-save when enabled', async () => {
            const autoSaveStorage = new OperationHistoryStorage( {
                maxEntries: 10,
                retentionDays: 1,
                autoSave: true
            } );

            await autoSaveStorage.initialize();

            const operation: AssignmentOperation = {
                operationId: 'test-op-1',
                operationType: 'CREATE',
                assignments: [],
                status: 'COMPLETED',
                errors: [],
                startTime: new Date(),
                endTime: new Date()
            };

            await autoSaveStorage.addOperation( operation );

            expect( mockFs.writeFile ).toHaveBeenCalled();
        } );
    } );

    describe( 'cleanup', () => {
        beforeEach( async () => {
            mockExistsSync.mockReturnValue( false );
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
            mockExistsSync.mockReturnValue( false );
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
