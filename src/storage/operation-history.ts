// Operation History Persistent Storage Manager
import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
import { AssignmentOperation } from '../types';

export interface OperationHistoryConfig {
    maxEntries?: number; // Maximum number of operations to keep
    retentionDays?: number; // Auto-cleanup operations older than this
    autoSave?: boolean; // Automatically save after each operation
}

export class OperationHistoryStorage {
    private readonly configDir: string;
    private readonly historyFile: string;
    private operationHistory: Map<string, AssignmentOperation> = new Map();
    private config: OperationHistoryConfig;
    private isLoaded: boolean = false;

    constructor( config: OperationHistoryConfig = {} ) {
        this.configDir = path.join( homedir(), '.aws-ag' );
        this.historyFile = path.join( this.configDir, 'operation-history.json' );
        this.config = {
            maxEntries: 1000,
            retentionDays: 30,
            autoSave: true,
            ...config
        };
    }

    /**
     * Initialize storage - create directory and load existing history
     */
    async initialize(): Promise<void> {
        try {
            // Ensure config directory exists
            await this.ensureConfigDirectory();

            // Load existing history
            await this.loadFromFile();

            // Clean up old entries
            await this.cleanup();

            this.isLoaded = true;
        } catch ( error ) {
            // eslint-disable-next-line no-console
            console.warn( `Warning: Failed to initialize operation history storage: ${error instanceof Error ? error.message : 'Unknown error'}` );
            // Continue with empty history
            this.isLoaded = true;
        }
    }

    /**
     * Ensure the config directory exists
     */
    private async ensureConfigDirectory(): Promise<void> {
        try {
            await fs.mkdir( this.configDir, { recursive: true } );
        } catch ( error ) {
            throw new Error( `Failed to create config directory ${this.configDir}: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Load operation history from file
     */
    private async loadFromFile(): Promise<void> {
        if ( !existsSync( this.historyFile ) ) {
            // File doesn't exist, start with empty history
            return;
        }

        try {
            const data = await fs.readFile( this.historyFile, 'utf8' );
            const parsed = JSON.parse( data );

            // Handle both array format (legacy) and object format
            let operations: AssignmentOperation[] = [];

            if ( Array.isArray( parsed ) ) {
                operations = parsed;
            } else if ( parsed.operations && Array.isArray( parsed.operations ) ) {
                operations = parsed.operations;
            } else {
                // eslint-disable-next-line no-console
                console.warn( 'Invalid operation history file format, starting fresh' );
                return;
            }

            // Convert to Map and restore Date objects
            this.operationHistory.clear();
            for ( const op of operations ) {
                // Restore Date objects
                op.startTime = new Date( op.startTime );
                if ( op.endTime ) {
                    op.endTime = new Date( op.endTime );
                }

                // Restore dates in assignments
                for ( const assignment of op.assignments ) {
                    assignment.createdDate = new Date( assignment.createdDate );
                    if ( assignment.lastValidated ) {
                        assignment.lastValidated = new Date( assignment.lastValidated );
                    }
                }

                // Restore dates in errors
                for ( const error of op.errors ) {
                    error.timestamp = new Date( error.timestamp );
                }

                this.operationHistory.set( op.operationId, op );
            }

            // eslint-disable-next-line no-console
            console.log( `Loaded ${this.operationHistory.size} operations from history file` );
        } catch ( error ) {
            // eslint-disable-next-line no-console
            console.warn( `Warning: Failed to load operation history from ${this.historyFile}: ${error instanceof Error ? error.message : 'Unknown error'}` );
            // Continue with empty history
        }
    }

    /**
     * Save operation history to file
     */
    async saveToFile(): Promise<void> {
        if ( !this.isLoaded ) {
            await this.initialize();
        }

        try {
            const operations = Array.from( this.operationHistory.values() );

            // Sort by start time (most recent first)
            operations.sort( ( a, b ) => b.startTime.getTime() - a.startTime.getTime() );

            const data = {
                version: '1.0',
                lastUpdated: new Date().toISOString(),
                totalOperations: operations.length,
                operations
            };

            await fs.writeFile( this.historyFile, JSON.stringify( data, null, 2 ), 'utf8' );
        } catch ( error ) {
            throw new Error( `Failed to save operation history to ${this.historyFile}: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Add or update an operation in history
     */
    async addOperation( operation: AssignmentOperation ): Promise<void> {
        if ( !this.isLoaded ) {
            await this.initialize();
        }

        this.operationHistory.set( operation.operationId, { ...operation } );

        if ( this.config.autoSave ) {
            await this.saveToFile();
        }
    }

    /**
     * Get an operation by ID
     */
    async getOperation( operationId: string ): Promise<AssignmentOperation | undefined> {
        if ( !this.isLoaded ) {
            await this.initialize();
        }

        const operation = this.operationHistory.get( operationId );
        return operation ? { ...operation } : undefined;
    }

    /**
     * Get all operations
     */
    async getAllOperations(): Promise<AssignmentOperation[]> {
        if ( !this.isLoaded ) {
            await this.initialize();
        }

        return Array.from( this.operationHistory.values() ).map( op => ( { ...op } ) );
    }

    /**
     * Get operations with filtering and pagination
     */
    async getOperations( options: {
        limit?: number;
        offset?: number;
        status?: string;
        operationType?: string;
        startDate?: Date;
        endDate?: Date;
    } = {} ): Promise<{
        operations: AssignmentOperation[];
        total: number;
        hasMore: boolean;
    }> {
        if ( !this.isLoaded ) {
            await this.initialize();
        }

        let operations = Array.from( this.operationHistory.values() );

        // Apply filters
        if ( options.status ) {
            operations = operations.filter( op => op.status === options.status );
        }

        if ( options.operationType ) {
            operations = operations.filter( op => op.operationType === options.operationType );
        }

        if ( options.startDate ) {
            operations = operations.filter( op => op.startTime >= options.startDate! );
        }

        if ( options.endDate ) {
            operations = operations.filter( op => op.startTime <= options.endDate! );
        }

        // Sort by start time (most recent first)
        operations.sort( ( a, b ) => b.startTime.getTime() - a.startTime.getTime() );

        const total = operations.length;
        const offset = options.offset || 0;
        const limit = options.limit || 50;

        // Apply pagination
        const paginatedOperations = operations.slice( offset, offset + limit );
        const hasMore = offset + limit < total;

        return {
            operations: paginatedOperations.map( op => ( { ...op } ) ),
            total,
            hasMore
        };
    }

    /**
     * Delete an operation
     */
    async deleteOperation( operationId: string ): Promise<boolean> {
        if ( !this.isLoaded ) {
            await this.initialize();
        }

        const deleted = this.operationHistory.delete( operationId );

        if ( deleted && this.config.autoSave ) {
            await this.saveToFile();
        }

        return deleted;
    }

    /**
     * Clean up old operations based on retention policy
     */
    async cleanup(): Promise<number> {
        if ( !this.isLoaded ) {
            await this.initialize();
        }

        let deletedCount = 0;
        const now = new Date();
        const cutoffDate = new Date( now.getTime() - ( this.config.retentionDays! * 24 * 60 * 60 * 1000 ) );

        // Remove operations older than retention period
        for ( const [ operationId, operation ] of this.operationHistory.entries() ) {
            if ( operation.startTime < cutoffDate ) {
                this.operationHistory.delete( operationId );
                deletedCount++;
            }
        }

        // Enforce max entries limit
        if ( this.config.maxEntries && this.operationHistory.size > this.config.maxEntries ) {
            const operations = Array.from( this.operationHistory.values() );
            operations.sort( ( a, b ) => b.startTime.getTime() - a.startTime.getTime() );

            // Keep only the most recent maxEntries operations
            const toKeep = operations.slice( 0, this.config.maxEntries );
            const toDelete = operations.slice( this.config.maxEntries );

            this.operationHistory.clear();
            for ( const op of toKeep ) {
                this.operationHistory.set( op.operationId, op );
            }

            deletedCount += toDelete.length;
        }

        if ( deletedCount > 0 && this.config.autoSave ) {
            await this.saveToFile();
        }

        return deletedCount;
    }

    /**
     * Get storage statistics
     */
    async getStatistics(): Promise<{
        totalOperations: number;
        operationsByStatus: Record<string, number>;
        operationsByType: Record<string, number>;
        oldestOperation?: Date;
        newestOperation?: Date;
        filePath: string;
        fileExists: boolean;
        fileSize?: number;
    }> {
        if ( !this.isLoaded ) {
            await this.initialize();
        }

        const operations = Array.from( this.operationHistory.values() );

        const operationsByStatus: Record<string, number> = {};
        const operationsByType: Record<string, number> = {};

        let oldestDate: Date | undefined;
        let newestDate: Date | undefined;

        for ( const op of operations ) {
            // Count by status
            operationsByStatus[ op.status ] = ( operationsByStatus[ op.status ] || 0 ) + 1;

            // Count by type
            operationsByType[ op.operationType ] = ( operationsByType[ op.operationType ] || 0 ) + 1;

            // Track date range
            if ( !oldestDate || op.startTime < oldestDate ) {
                oldestDate = op.startTime;
            }
            if ( !newestDate || op.startTime > newestDate ) {
                newestDate = op.startTime;
            }
        }

        // Get file info
        let fileSize: number | undefined;
        const fileExists = existsSync( this.historyFile );

        if ( fileExists ) {
            try {
                const stats = await fs.stat( this.historyFile );
                fileSize = stats.size;
            } catch {
                // Ignore errors getting file size
            }
        }

        return {
            totalOperations: operations.length,
            operationsByStatus,
            operationsByType,
            oldestOperation: oldestDate,
            newestOperation: newestDate,
            filePath: this.historyFile,
            fileExists,
            fileSize
        };
    }

    /**
     * Export operation history to a different file
     */
    async exportToFile( filePath: string ): Promise<void> {
        if ( !this.isLoaded ) {
            await this.initialize();
        }

        const operations = Array.from( this.operationHistory.values() );
        operations.sort( ( a, b ) => b.startTime.getTime() - a.startTime.getTime() );

        const data = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            totalOperations: operations.length,
            operations
        };

        await fs.writeFile( filePath, JSON.stringify( data, null, 2 ), 'utf8' );
    }

    /**
     * Import operation history from a file
     */
    async importFromFile( filePath: string, merge: boolean = false ): Promise<number> {
        if ( !this.isLoaded ) {
            await this.initialize();
        }

        try {
            const data = await fs.readFile( filePath, 'utf8' );
            const parsed = JSON.parse( data );

            let operations: AssignmentOperation[] = [];

            if ( Array.isArray( parsed ) ) {
                operations = parsed;
            } else if ( parsed.operations && Array.isArray( parsed.operations ) ) {
                operations = parsed.operations;
            } else {
                throw new Error( 'Invalid file format' );
            }

            if ( !merge ) {
                this.operationHistory.clear();
            }

            let importedCount = 0;

            for ( const op of operations ) {
                // Restore Date objects
                op.startTime = new Date( op.startTime );
                if ( op.endTime ) {
                    op.endTime = new Date( op.endTime );
                }

                // Restore dates in assignments
                for ( const assignment of op.assignments ) {
                    assignment.createdDate = new Date( assignment.createdDate );
                    if ( assignment.lastValidated ) {
                        assignment.lastValidated = new Date( assignment.lastValidated );
                    }
                }

                // Restore dates in errors
                for ( const error of op.errors ) {
                    error.timestamp = new Date( error.timestamp );
                }

                this.operationHistory.set( op.operationId, op );
                importedCount++;
            }

            if ( this.config.autoSave ) {
                await this.saveToFile();
            }

            return importedCount;
        } catch ( error ) {
            throw new Error( `Failed to import operation history from ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Clear all operation history
     */
    async clear(): Promise<void> {
        if ( !this.isLoaded ) {
            await this.initialize();
        }

        this.operationHistory.clear();

        if ( this.config.autoSave ) {
            await this.saveToFile();
        }
    }

    /**
     * Get the file path where history is stored
     */
    getHistoryFilePath(): string {
        return this.historyFile;
    }

    /**
     * Check if storage is initialized
     */
    isInitialized(): boolean {
        return this.isLoaded;
    }
}

// Export singleton instance with default configuration
export const operationHistoryStorage = new OperationHistoryStorage();
