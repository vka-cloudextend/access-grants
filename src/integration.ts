// Integration Layer - Wires all components together with proper error handling and logging
import { AssignmentOrchestrator, OrchestrationConfig } from './orchestrator';
import { ReportingService, ReportingServiceConfig } from './reporting-service';
import { ValidationService, ValidationServiceConfig } from './validation-service';
import { configManager, validateConfig } from './config';
import { ErrorHandler, RetryManager, ConfigurationError } from './errors';
import { OperationHistoryStorage } from './storage/operation-history';

export interface IntegrationConfig {
    enableLogging?: boolean;
    enableReporting?: boolean;
    enableValidation?: boolean;
    reportingInterval?: number; // hours
    cleanupInterval?: number; // hours
    gracefulShutdownTimeout?: number; // milliseconds
}

export interface SystemStatus {
    orchestrator: {
        initialized: boolean;
        operationsCount: number;
        errors: string[];
    };
    reporting: {
        initialized: boolean;
        lastReportTime?: Date;
        errors: string[];
    };
    validation: {
        initialized: boolean;
        lastValidationTime?: Date;
        errors: string[];
    };
    storage: {
        initialized: boolean;
        operationsStored: number;
        errors: string[];
    };
    overall: 'HEALTHY' | 'WARNING' | 'ERROR';
}

/**
 * Main integration class that coordinates all system components
 * Implements Requirements: All requirements - Integration and wiring
 */
export class SystemIntegration {
    private orchestrator?: AssignmentOrchestrator;
    private reportingService?: ReportingService;
    private validationService?: ValidationService;
    private operationStorage: OperationHistoryStorage;
    private retryManager: RetryManager;
    private config: IntegrationConfig;
    private isInitialized = false;
    private shutdownHandlers: Array<() => Promise<void>> = [];
    private periodicTasks: Array<ReturnType<typeof setInterval>> = [];

    constructor( config: IntegrationConfig = {} ) {
        this.config = {
            enableLogging: true,
            enableReporting: true,
            enableValidation: true,
            reportingInterval: 24, // 24 hours
            cleanupInterval: 168, // 7 days
            gracefulShutdownTimeout: 30000, // 30 seconds
            ...config
        };

        this.operationStorage = new OperationHistoryStorage();
        this.retryManager = new RetryManager();

        // Set up graceful shutdown handlers
        this.setupGracefulShutdown();
    }

    /**
     * Initialize all system components
     */
    async initialize(): Promise<void> {
        if ( this.isInitialized ) {
            console.warn( 'System already initialized' );
            return;
        }

        try {
            console.log( '🚀 Initializing AWS Access Grants system...' );

            // Validate configuration first
            const configValidation = validateConfig();
            if ( !configValidation.isValid ) {
                throw new ConfigurationError(
                    `Configuration validation failed: ${configValidation.errors.join( ', ' )}`,
                    { errors: configValidation.errors }
                );
            }

            if ( configValidation.warnings.length > 0 ) {
                console.warn( '⚠️  Configuration warnings:' );
                configValidation.warnings.forEach( warning => {
                    console.warn( `  - ${warning}` );
                } );
            }

            const systemConfig = configManager.getConfig();

            // Initialize orchestrator
            console.log( '📋 Initializing orchestrator...' );
            const orchestrationConfig: OrchestrationConfig = {
                azure: systemConfig.azure,
                aws: systemConfig.aws,
                retryAttempts: systemConfig.retry.maxAttempts,
                retryDelayMs: systemConfig.retry.baseDelayMs
            };
            this.orchestrator = new AssignmentOrchestrator( orchestrationConfig, this.operationStorage );

            // Initialize reporting service if enabled
            if ( this.config.enableReporting ) {
                console.log( '📊 Initializing reporting service...' );
                const reportingConfig: ReportingServiceConfig = {
                    azure: systemConfig.azure,
                    aws: systemConfig.aws,
                    reporting: {
                        outputDirectory: './reports',
                        retentionDays: 90,
                        enableAuditLog: true
                    }
                };
                this.reportingService = new ReportingService( reportingConfig );
            }

            // Initialize validation service if enabled
            if ( this.config.enableValidation ) {
                console.log( '✅ Initializing validation service...' );
                const validationConfig: ValidationServiceConfig = {
                    azure: systemConfig.azure,
                    aws: systemConfig.aws
                };
                this.validationService = new ValidationService( validationConfig );
            }

            // Set up periodic tasks
            this.setupPeriodicTasks();

            this.isInitialized = true;
            console.log( '✅ System initialization completed successfully' );

        } catch ( error ) {
            console.error( '❌ System initialization failed' );
            throw error;
        }
    }

    /**
     * Get the orchestrator instance (ensures initialization)
     */
    async getOrchestrator(): Promise<AssignmentOrchestrator> {
        if ( !this.isInitialized ) {
            await this.initialize();
        }

        if ( !this.orchestrator ) {
            throw new ConfigurationError(
                'Orchestrator not initialized'
            );
        }

        return this.orchestrator;
    }

    /**
     * Get the reporting service instance (ensures initialization)
     */
    async getReportingService(): Promise<ReportingService | undefined> {
        if ( !this.isInitialized ) {
            await this.initialize();
        }
        return this.reportingService;
    }

    /**
     * Get the validation service instance (ensures initialization)
     */
    async getValidationService(): Promise<ValidationService | undefined> {
        if ( !this.isInitialized ) {
            await this.initialize();
        }
        return this.validationService;
    }

    /**
     * Get system status and health information
     */
    async getSystemStatus(): Promise<SystemStatus> {
        const status: SystemStatus = {
            orchestrator: {
                initialized: !!this.orchestrator,
                operationsCount: 0,
                errors: []
            },
            reporting: {
                initialized: !!this.reportingService,
                errors: []
            },
            validation: {
                initialized: !!this.validationService,
                errors: []
            },
            storage: {
                initialized: true,
                operationsStored: 0,
                errors: []
            },
            overall: 'HEALTHY'
        };

        try {
            // Check orchestrator status
            if ( this.orchestrator ) {
                const operations = await this.orchestrator.listOperations();
                status.orchestrator.operationsCount = operations.length;
            }

            // Check storage status
            const allOperations = await this.operationStorage.getAllOperations();
            status.storage.operationsStored = allOperations.length;

            // Check reporting service status
            if ( this.reportingService ) {
                try {
                    const healthReport = await this.reportingService.generateSystemHealthReport();
                    if ( healthReport.overallHealth === 'CRITICAL' ) {
                        status.reporting.errors.push( 'System health check failed' );
                    }
                } catch ( error ) {
                    status.reporting.errors.push( error instanceof Error ? error.message : 'Unknown error' );
                }
            }

        } catch ( error ) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            status.orchestrator.errors.push( errorMessage );
        }

        // Determine overall status
        const hasErrors = [
            status.orchestrator.errors,
            status.reporting.errors,
            status.validation.errors,
            status.storage.errors
        ].some( errors => errors.length > 0 );

        const hasUninitialized = !status.orchestrator.initialized ||
            ( this.config.enableReporting && !status.reporting.initialized ) ||
            ( this.config.enableValidation && !status.validation.initialized );

        if ( hasErrors ) {
            status.overall = 'ERROR';
        } else if ( hasUninitialized ) {
            status.overall = 'WARNING';
        } else {
            status.overall = 'HEALTHY';
        }

        return status;
    }

    /**
     * Execute operation with full error handling and logging
     */
    async executeWithErrorHandling<T>(
        operation: () => Promise<T>,
        operationName: string,
        retryOptions?: { maxAttempts?: number; baseDelayMs?: number }
    ): Promise<T> {
        try {
            console.log( `🔄 Starting operation: ${operationName}` );

            let result: T;

            if ( retryOptions ) {
                // Use custom retry options
                const customRetryManager = new RetryManager( {
                    maxAttempts: retryOptions.maxAttempts,
                    baseDelayMs: retryOptions.baseDelayMs
                } );
                result = await customRetryManager.execute( operation, operationName );
            } else {
                // Use default retry manager
                result = await this.retryManager.execute( operation, operationName );
            }

            console.log( `✅ Operation completed successfully: ${operationName}` );

            // Log to reporting service if available
            if ( this.reportingService ) {
                try {
                    // This would need to be implemented in the reporting service
                    // await this.reportingService.logOperationSuccess(operationName);
                } catch ( error ) {
                    console.warn( `Failed to log operation success: ${error instanceof Error ? error.message : 'Unknown error'}` );
                }
            }

            return result;

        } catch ( error ) {
            console.error( `❌ Operation failed: ${operationName}` );

            // Log to reporting service if available
            if ( this.reportingService ) {
                try {
                    // This would need to be implemented in the reporting service
                    // await this.reportingService.logOperationFailure(operationName, error);
                } catch ( logError ) {
                    console.warn( `Failed to log operation failure: ${logError instanceof Error ? logError.message : 'Unknown error'}` );
                }
            }

            throw error;
        }
    }

    /**
     * Execute critical operation with enhanced retry settings
     * Example usage of executeWithErrorHandling with custom retry options
     */
    async executeCriticalOperation<T>(
        operation: () => Promise<T>,
        operationName: string
    ): Promise<T> {
        return this.executeWithErrorHandling(
            operation,
            operationName,
            {
                maxAttempts: 5,        // More attempts for critical operations
                baseDelayMs: 2000      // Longer delay between retries
            }
        );
    }

    /**
     * Execute fast operation with minimal retry settings
     * Example usage of executeWithErrorHandling with custom retry options
     */
    async executeFastOperation<T>(
        operation: () => Promise<T>,
        operationName: string
    ): Promise<T> {
        return this.executeWithErrorHandling(
            operation,
            operationName,
            {
                maxAttempts: 2,        // Fewer attempts for fast operations
                baseDelayMs: 500       // Shorter delay between retries
            }
        );
    }

    /**
     * Set up periodic maintenance tasks
     */
    private setupPeriodicTasks(): void {
        // Periodic reporting
        if ( this.config.enableReporting && this.reportingService && this.config.reportingInterval ) {
            const reportingTask = this.reportingService.schedulePeriodicReporting( this.config.reportingInterval );
            this.periodicTasks.push( reportingTask );
            console.log( `📊 Scheduled periodic reporting every ${this.config.reportingInterval} hours` );
        }

        // Periodic cleanup
        if ( this.config.cleanupInterval ) {
            const cleanupTask = setInterval( async () => {
                try {
                    console.log( '🧹 Running periodic cleanup...' );

                    if ( this.orchestrator ) {
                        await this.orchestrator.cleanupOldOperations( this.config.cleanupInterval! * 24 ); // Convert days to hours
                    }

                    await this.operationStorage.cleanup();

                    console.log( '✅ Periodic cleanup completed' );
                } catch ( error ) {
                    console.error( `❌ Periodic cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}` );
                }
            }, this.config.cleanupInterval * 60 * 60 * 1000 ); // Convert hours to milliseconds

            this.periodicTasks.push( cleanupTask );
            console.log( `🧹 Scheduled periodic cleanup every ${this.config.cleanupInterval} hours` );
        }
    }

    /**
     * Set up graceful shutdown handlers
     */
    private setupGracefulShutdown(): void {
        const shutdown = async ( signal: string ) => {
            console.log( `\n🛑 Received ${signal}, initiating graceful shutdown...` );

            const shutdownTimeout = setTimeout( () => {
                console.error( '⚠️  Graceful shutdown timeout, forcing exit' );
                process.exit( 1 );
            }, this.config.gracefulShutdownTimeout );

            try {
                // Clear periodic tasks
                console.log( '🧹 Clearing periodic tasks...' );
                this.periodicTasks.forEach( task => clearInterval( task ) );
                this.periodicTasks = [];

                // Execute shutdown handlers
                console.log( '🔄 Executing shutdown handlers...' );
                for ( const handler of this.shutdownHandlers ) {
                    await handler();
                }

                // Final cleanup
                if ( this.orchestrator ) {
                    console.log( '📋 Cleaning up orchestrator...' );
                    await this.orchestrator.cleanupOldOperations( 0 ); // Clean up all in-memory state
                }

                console.log( '✅ Graceful shutdown completed' );
                clearTimeout( shutdownTimeout );
                process.exit( 0 );

            } catch ( error ) {
                console.error( `❌ Error during graceful shutdown: ${error instanceof Error ? error.message : 'Unknown error'}` );
                clearTimeout( shutdownTimeout );
                process.exit( 1 );
            }
        };

        // Handle various shutdown signals
        process.on( 'SIGINT', () => shutdown( 'SIGINT' ) );
        process.on( 'SIGTERM', () => shutdown( 'SIGTERM' ) );
        process.on( 'SIGQUIT', () => shutdown( 'SIGQUIT' ) );

        // Handle uncaught exceptions and unhandled rejections
        process.on( 'uncaughtException', ( error ) => {
            console.error( '💥 Uncaught Exception:', error );
            ErrorHandler.handleError( error, 'Uncaught Exception' );
        } );

        process.on( 'unhandledRejection', ( reason, promise ) => {
            console.error( '💥 Unhandled Rejection at:', promise, 'reason:', reason );
            ErrorHandler.handleError( reason, 'Unhandled Rejection' );
        } );
    }

    /**
     * Add a custom shutdown handler
     */
    addShutdownHandler( handler: () => Promise<void> ): void {
        this.shutdownHandlers.push( handler );
    }

    /**
     * Perform system health check
     */
    async performHealthCheck(): Promise<{
        healthy: boolean;
        status: SystemStatus;
        recommendations: string[];
    }> {
        const status = await this.getSystemStatus();
        const recommendations: string[] = [];

        // Check for common issues and provide recommendations
        if ( !status.orchestrator.initialized ) {
            recommendations.push( 'Initialize the orchestrator component' );
        }

        if ( status.orchestrator.errors.length > 0 ) {
            recommendations.push( 'Check orchestrator configuration and connectivity' );
        }

        if ( this.config.enableReporting && !status.reporting.initialized ) {
            recommendations.push( 'Initialize the reporting service' );
        }

        if ( status.reporting.errors.length > 0 ) {
            recommendations.push( 'Check reporting service configuration and output directory permissions' );
        }

        if ( this.config.enableValidation && !status.validation.initialized ) {
            recommendations.push( 'Initialize the validation service' );
        }

        if ( status.storage.errors.length > 0 ) {
            recommendations.push( 'Check storage configuration and file system permissions' );
        }

        return {
            healthy: status.overall === 'HEALTHY',
            status,
            recommendations
        };
    }

    /**
     * Get integration statistics
     */
    async getIntegrationStatistics(): Promise<{
        uptime: number; // milliseconds
        operationsProcessed: number;
        errorsEncountered: number;
        lastHealthCheck: Date;
        memoryUsage: NodeJS.MemoryUsage;
    }> {
        const status = await this.getSystemStatus();

        return {
            uptime: process.uptime() * 1000,
            operationsProcessed: status.storage.operationsStored,
            errorsEncountered: [
                ...status.orchestrator.errors,
                ...status.reporting.errors,
                ...status.validation.errors,
                ...status.storage.errors
            ].length,
            lastHealthCheck: new Date(),
            memoryUsage: process.memoryUsage()
        };
    }
}

// Export singleton instance for use throughout the application
export const systemIntegration = new SystemIntegration();

// Export convenience functions
export const getOrchestrator = () => systemIntegration.getOrchestrator();
export const getReportingService = () => systemIntegration.getReportingService();
export const getValidationService = () => systemIntegration.getValidationService();
export const getSystemStatus = () => systemIntegration.getSystemStatus();
export const performHealthCheck = () => systemIntegration.performHealthCheck();
