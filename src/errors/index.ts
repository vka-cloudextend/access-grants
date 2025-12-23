// Comprehensive Error Handling for AWS Access Grants (aws-ag)
import { getRetryConfig } from '../config';

/**
 * Base error class for all aws-ag errors
 */
export abstract class AWSAGError extends Error {
    public readonly code: string;
    public readonly timestamp: Date;
    public readonly context?: Record<string, unknown>;
    public readonly retryable: boolean;
    public readonly userMessage: string;

    constructor(
        message: string,
        code: string,
        userMessage?: string,
        retryable: boolean = false,
        context?: Record<string, unknown>
    ) {
        super( message );
        this.name = this.constructor.name;
        this.code = code;
        this.timestamp = new Date();
        this.context = context;
        this.retryable = retryable;
        this.userMessage = userMessage || message;

        // Maintain proper stack trace
        if ( Error.captureStackTrace ) {
            Error.captureStackTrace( this, this.constructor );
        }
    }

    /**
     * Get formatted error message for user display
     */
    getDisplayMessage(): string {
        return `[${this.code}] ${this.userMessage}`;
    }

    /**
     * Get detailed error information for logging
     */
    getDetailedInfo(): Record<string, unknown> {
        return {
            name: this.name,
            code: this.code,
            message: this.message,
            userMessage: this.userMessage,
            timestamp: this.timestamp.toISOString(),
            retryable: this.retryable,
            context: this.context,
            stack: this.stack
        };
    }
}

/**
 * Configuration-related errors
 * Implements Requirements 7.1: Specific error messages for common failure scenarios
 */
export class ConfigurationError extends AWSAGError {
    constructor( message: string, context?: Record<string, unknown> ) {
        super(
            message,
            'CONFIG_ERROR',
            `Configuration error: ${message}. Please check your environment variables or config files.`,
            false,
            context
        );
    }
}

/**
 * Azure AD integration errors
 * Implements Requirements 7.1: Specific error messages for Azure AD failures
 */
export class AzureError extends AWSAGError {
    constructor(
        message: string,
        code: string = 'AZURE_ERROR',
        retryable: boolean = false,
        context?: Record<string, unknown>
    ) {
        const userMessage = AzureError.getUserMessage( code, message );
        super( message, code, userMessage, retryable, context );
    }

    private static getUserMessage( code: string, message: string ): string {
        switch ( code ) {
            case 'AZURE_AUTH_FAILED':
                return 'Azure authentication failed. Please check your Azure credentials (tenant ID, client ID, and client secret).';
            case 'AZURE_GROUP_NOT_FOUND':
                return 'The specified Azure AD group was not found. Please verify the group ID or name.';
            case 'AZURE_GROUP_CREATE_FAILED':
                return 'Failed to create Azure AD group. Please check your permissions and try again.';
            case 'AZURE_PERMISSION_DENIED':
                return 'Permission denied in Azure AD. Please ensure your application has the required permissions.';
            case 'AZURE_RATE_LIMITED':
                return 'Azure AD API rate limit exceeded. Please wait a moment and try again.';
            case 'AZURE_SERVICE_UNAVAILABLE':
                return 'Azure AD service is temporarily unavailable. Please try again later.';
            default:
                return `Azure AD error: ${message}`;
        }
    }
}

/**
 * AWS integration errors
 * Implements Requirements 7.1: Specific error messages for AWS failures
 */
export class AWSError extends AWSAGError {
    constructor(
        message: string,
        code: string = 'AWS_ERROR',
        retryable: boolean = false,
        context?: Record<string, unknown>
    ) {
        const userMessage = AWSError.getUserMessage( code, message );
        super( message, code, userMessage, retryable, context );
    }

    private static getUserMessage( code: string, message: string ): string {
        switch ( code ) {
            case 'AWS_AUTH_FAILED':
                return 'AWS authentication failed. Please check your AWS credentials and permissions.';
            case 'AWS_PERMISSION_SET_NOT_FOUND':
                return 'The specified AWS permission set was not found. Please verify the permission set ARN.';
            case 'AWS_PERMISSION_SET_CREATE_FAILED':
                return 'Failed to create AWS permission set. Please check your permissions and policy configuration.';
            case 'AWS_ASSIGNMENT_FAILED':
                return 'Failed to create account assignment. Please check that the group is synchronized and the permission set exists.';
            case 'AWS_ASSIGNMENT_NOT_FOUND':
                return 'The specified account assignment was not found.';
            case 'AWS_THROTTLED':
                return 'AWS API rate limit exceeded. Please wait a moment and try again.';
            case 'AWS_SERVICE_UNAVAILABLE':
                return 'AWS service is temporarily unavailable. Please try again later.';
            case 'AWS_INVALID_POLICY':
                return 'The provided IAM policy is invalid. Please check the policy syntax and permissions.';
            default:
                return `AWS error: ${message}`;
        }
    }
}

/**
 * Validation errors
 * Implements Requirements 7.1: Specific error messages for validation failures
 */
export class ValidationError extends AWSAGError {
    constructor( message: string, context?: Record<string, unknown> ) {
        super(
            message,
            'VALIDATION_ERROR',
            `Validation failed: ${message}`,
            false,
            context
        );
    }
}

/**
 * Operation errors for workflow failures
 * Implements Requirements 7.2: Partial failure handling for bulk operations
 */
export class OperationError extends AWSAGError {
    public readonly operationId: string;
    public readonly step: string;

    constructor(
        message: string,
        operationId: string,
        step: string,
        code: string = 'OPERATION_ERROR',
        retryable: boolean = false,
        context?: Record<string, unknown>
    ) {
        super(
            message,
            code,
            `Operation ${operationId} failed at step '${step}': ${message}`,
            retryable,
            { ...context, operationId, step }
        );
        this.operationId = operationId;
        this.step = step;
    }
}

/**
 * Bulk operation errors for handling multiple failures
 * Implements Requirements 7.2: Partial failure handling for bulk operations
 */
export class BulkOperationError extends AWSAGError {
    public readonly failures: Array<{
        index: number;
        item: unknown;
        error: AWSAGError;
    }>;
    public readonly successCount: number;
    public readonly totalCount: number;

    constructor(
        failures: Array<{ index: number; item: unknown; error: AWSAGError }>,
        successCount: number,
        totalCount: number
    ) {
        const failureCount = failures.length;
        const message = `Bulk operation completed with ${failureCount} failures out of ${totalCount} items`;

        super(
            message,
            'BULK_OPERATION_ERROR',
            `${successCount}/${totalCount} operations succeeded. ${failureCount} operations failed.`,
            false,
            { failures: failures.map( f => f.error.getDetailedInfo() ), successCount, totalCount }
        );

        this.failures = failures;
        this.successCount = successCount;
        this.totalCount = totalCount;
    }

    /**
     * Get summary of failures by error type
     */
    getFailureSummary(): Record<string, number> {
        const summary: Record<string, number> = {};
        for ( const failure of this.failures ) {
            const errorType = failure.error.code;
            summary[ errorType ] = ( summary[ errorType ] || 0 ) + 1;
        }
        return summary;
    }

    /**
     * Get detailed failure report
     */
    getFailureReport(): string {
        const lines: string[] = [];
        lines.push( `Bulk Operation Failure Report` );
        lines.push( `============================` );
        lines.push( `Total Items: ${this.totalCount}` );
        lines.push( `Successful: ${this.successCount}` );
        lines.push( `Failed: ${this.failures.length}` );
        lines.push( '' );

        const summary = this.getFailureSummary();
        lines.push( 'Failure Summary by Type:' );
        for ( const [ errorType, count ] of Object.entries( summary ) ) {
            lines.push( `  ${errorType}: ${count}` );
        }
        lines.push( '' );

        lines.push( 'Individual Failures:' );
        for ( const failure of this.failures ) {
            lines.push( `  Item ${failure.index}: [${failure.error.code}] ${failure.error.userMessage}` );
        }

        return lines.join( '\n' );
    }
}

/**
 * Retry configuration and logic
 * Implements Requirements 7.1: Retry logic for transient failures
 */
export interface RetryOptions {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    exponentialBackoff?: boolean;
    retryableErrors?: string[];
}

/**
 * Retry utility class
 * Implements Requirements 7.1: Retry logic for transient failures
 */
export class RetryManager {
    private options: Required<RetryOptions>;

    constructor( options?: RetryOptions ) {
        const config = getRetryConfig();
        this.options = {
            maxAttempts: options?.maxAttempts ?? config.maxAttempts,
            baseDelayMs: options?.baseDelayMs ?? config.baseDelayMs,
            maxDelayMs: options?.maxDelayMs ?? config.maxDelayMs,
            exponentialBackoff: options?.exponentialBackoff ?? config.exponentialBackoff,
            retryableErrors: options?.retryableErrors ?? [
                'AZURE_RATE_LIMITED',
                'AZURE_SERVICE_UNAVAILABLE',
                'AWS_THROTTLED',
                'AWS_SERVICE_UNAVAILABLE',
                'NETWORK_ERROR',
                'TIMEOUT_ERROR'
            ]
        };
    }

    /**
     * Execute a function with retry logic
     */
    async execute<T>(
        operation: () => Promise<T>,
        operationName: string = 'operation'
    ): Promise<T> {
        let lastError: Error;
        let attempt = 0;

        while ( attempt < this.options.maxAttempts ) {
            attempt++;

            try {
                return await operation();
            } catch ( error ) {
                lastError = error instanceof Error ? error : new Error( String( error ) );

                // Check if error is retryable
                const isRetryable = this.isRetryableError( lastError );
                const isLastAttempt = attempt >= this.options.maxAttempts;

                if ( !isRetryable || isLastAttempt ) {
                    throw lastError;
                }

                // Calculate delay for next attempt
                const delay = this.calculateDelay( attempt );

                console.warn(
                    `${operationName} failed (attempt ${attempt}/${this.options.maxAttempts}): ${lastError.message}. ` +
                    `Retrying in ${delay}ms...`
                );

                await this.sleep( delay );
            }
        }

        throw lastError!;
    }

    /**
     * Check if an error is retryable
     */
    private isRetryableError( error: Error ): boolean {
        // Check if it's an AWSAGError with retryable flag
        if ( error instanceof AWSAGError ) {
            return error.retryable || this.options.retryableErrors.includes( error.code );
        }

        // Check for common retryable error patterns
        const message = error.message.toLowerCase();
        const retryablePatterns = [
            'timeout',
            'rate limit',
            'throttle',
            'service unavailable',
            'temporary failure',
            'connection reset',
            'network error'
        ];

        return retryablePatterns.some( pattern => message.includes( pattern ) );
    }

    /**
     * Calculate delay for retry attempt
     */
    private calculateDelay( attempt: number ): number {
        if ( !this.options.exponentialBackoff ) {
            return Math.min( this.options.baseDelayMs, this.options.maxDelayMs );
        }

        // Exponential backoff with jitter
        const exponentialDelay = this.options.baseDelayMs * Math.pow( 2, attempt - 1 );
        const jitter = Math.random() * 0.1 * exponentialDelay; // 10% jitter
        const delay = exponentialDelay + jitter;

        return Math.min( delay, this.options.maxDelayMs );
    }

    /**
     * Sleep for specified milliseconds
     */
    private sleep( ms: number ): Promise<void> {
        return new Promise( resolve => setTimeout( resolve, ms ) );
    }
}

/**
 * Error handler utility functions
 */
export class ErrorHandler {
    /**
     * Handle and format errors for CLI display
     * Implements Requirements 7.1: Specific error messages for common failure scenarios
     */
    static handleError( error: unknown, context?: string ): never {
        let displayError: AWSAGError;

        if ( error instanceof AWSAGError ) {
            displayError = error;
        } else if ( error instanceof Error ) {
            displayError = new ValidationError(
                `An unexpected error occurred: ${error.message}`,
                { originalError: error.name, context }
            );
        } else {
            displayError = new ValidationError(
                'An unexpected error occurred',
                { originalError: String( error ), context }
            );
        }

        // Log detailed error information
        console.error( 'Error Details:', JSON.stringify( displayError.getDetailedInfo(), null, 2 ) );

        // Display user-friendly error message
        console.error( `\nError: ${displayError.getDisplayMessage()}` );

        if ( displayError.retryable ) {
            console.error( 'This error may be temporary. Please try again.' );
        }

        // Provide context-specific guidance
        if ( context ) {
            console.error( `Context: ${context}` );
        }

        process.exit( 1 );
    }

    /**
     * Wrap async operations with error handling
     */
    static async wrapAsync<T>(
        operation: () => Promise<T>,
        context?: string,
        retryOptions?: RetryOptions
    ): Promise<T> {
        try {
            if ( retryOptions ) {
                const retryManager = new RetryManager( retryOptions );
                return await retryManager.execute( operation, context );
            } else {
                return await operation();
            }
        } catch ( error ) {
            ErrorHandler.handleError( error, context );
        }
    }

    /**
     * Create error from AWS SDK error
     */
    static fromAWSError( error: any, context?: Record<string, unknown> ): AWSError {
        const code = error.name || error.Code || 'AWS_ERROR';
        const message = error.message || error.Message || 'Unknown AWS error';

        // Determine if error is retryable based on AWS error codes
        const retryable = [
            'Throttling',
            'ThrottlingException',
            'ServiceUnavailable',
            'InternalServerError',
            'RequestTimeout'
        ].includes( code );

        return new AWSError( message, `AWS_${code.toUpperCase()}`, retryable, {
            ...context,
            awsErrorCode: code,
            awsRequestId: error.$metadata?.requestId
        } );
    }

    /**
     * Create error from Azure Graph error
     */
    static fromAzureError( error: any, context?: Record<string, unknown> ): AzureError {
        const code = error.code || error.error?.code || 'AZURE_ERROR';
        const message = error.message || error.error?.message || 'Unknown Azure error';

        // Determine if error is retryable based on Azure error codes
        const retryable = [
            'TooManyRequests',
            'ServiceUnavailable',
            'InternalServerError',
            'Timeout'
        ].includes( code );

        return new AzureError( message, `AZURE_${code.toUpperCase()}`, retryable, {
            ...context,
            azureErrorCode: code,
            azureRequestId: error.requestId
        } );
    }
}

/**
 * Validation utilities
 */
export class ValidationUtils {
    /**
     * Validate email format
     */
    static validateEmail( email: string ): void {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if ( !emailRegex.test( email ) ) {
            throw new ValidationError( `Invalid email format: ${email}` );
        }
    }

    /**
     * Validate AWS account ID format
     */
    static validateAWSAccountId( accountId: string ): void {
        if ( !/^\d{12}$/.test( accountId ) ) {
            throw new ValidationError( `Invalid AWS account ID format: ${accountId}. Must be 12 digits.` );
        }
    }

    /**
     * Validate ticket ID format
     */
    static validateTicketId( ticketId: string ): void {
        if ( !/^AG-\d{3,4}$/.test( ticketId ) ) {
            throw new ValidationError( `Invalid ticket ID format: ${ticketId}. Expected format: AG-XXX or AG-XXXX` );
        }
    }

    /**
     * Validate account type
     */
    static validateAccountType( accountType: string ): void {
        if ( ![ 'Dev', 'QA', 'Staging', 'Prod' ].includes( accountType ) ) {
            throw new ValidationError( `Invalid account type: ${accountType}. Must be one of: Dev, QA, Staging, Prod` );
        }
    }

    /**
     * Validate group name format
     */
    static validateGroupName( groupName: string ): void {
        const nameParts = groupName.split( '-' );
        if ( nameParts.length !== 5 || nameParts[ 0 ] !== 'CE' || nameParts[ 1 ] !== 'AWS' ) {
            throw new ValidationError( `Invalid group name format: ${groupName}. Expected format: CE-AWS-<Account>-<TicketId>` );
        }

        ValidationUtils.validateAccountType( nameParts[ 2 ] );
        ValidationUtils.validateTicketId( `${nameParts[ 3 ]}-${nameParts[ 4 ]}` );
    }
}

// Export singleton instances
export const retryManager = new RetryManager();
export const errorHandler = ErrorHandler;
