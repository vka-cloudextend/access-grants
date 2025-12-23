// Main entry point for AWS Access Grants (aws-ag)
export * from './cli';
export * from './types';
export * from './clients';
export * from './orchestrator';
export * from './validator';
export * from './reporter';

// Explicit exports to avoid conflicts
export {
    configManager,
    getConfig,
    getAzureConfig,
    getAWSConfig,
    getLoggingConfig,
    getRetryConfig,
    validateConfig,
    type AzureConfig,
    type AWSConfig,
    type LoggingConfig,
    type RetryConfig
} from './config';

export {
    ErrorHandler,
    ValidationUtils,
    RetryManager,
    AWSAGError,
    ConfigurationError,
    AzureError,
    AWSError,
    ValidationError,
    OperationError as ErrorOperationError,
    BulkOperationError
} from './errors';
