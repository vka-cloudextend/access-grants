// Configuration Management for AWS Access Grants (aws-ag)
import { config as dotenvxConfig } from '@dotenvx/dotenvx';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface AzureConfig {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    enterpriseApplicationId: string;
}

export interface AWSConfig {
    region: string;
    identityCenterInstanceArn: string;
    identityStoreId: string;
    profile?: string; // AWS profile name from ~/.aws/credentials
    accountMapping: {
        Dev: string;
        QA: string;
        Staging: string;
        Prod: string;
    };
}

export interface LoggingConfig {
    level: 'debug' | 'info' | 'warn' | 'error';
    file?: string;
    enableConsole: boolean;
}

export interface RetryConfig {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    exponentialBackoff: boolean;
}

export interface ToolConfig {
    azure: AzureConfig;
    aws: AWSConfig;
    logging: LoggingConfig;
    retry: RetryConfig;
    templates: {
        permissionSetTemplatesPath?: string;
        defaultSessionDuration: string;
    };
}

export interface ConfigValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Configuration manager that supports multiple sources:
 * 1. Environment variables
 * 2. Configuration files (.env, config.json)
 * 3. Default values
 *
 * Implements Requirements 5.4, 8.2: Configuration management with environment variables and config files
 */
export class ConfigManager {
    private config: ToolConfig;
    private configSources: string[] = [];

    constructor( options: { skipEnvLoad?: boolean } = {} ) {
        this.config = this.loadConfiguration( options.skipEnvLoad );
    }

    /**
     * Load configuration from multiple sources in priority order:
     * 1. Environment variables (highest priority)
     * 2. Local config file (./config.json)
     * 3. User config file (~/.aws-ag/config.json)
     * 4. Default values (lowest priority)
     */
    private loadConfiguration( skipEnvLoad = false ): ToolConfig {
        // Load environment variables first (unless skipped for testing)
        if ( !skipEnvLoad ) {
            this.loadEnvironmentFiles();
        }

        // Start with default configuration
        let config = this.getDefaultConfig();
        this.configSources.push( 'defaults' );

        // Try to load user config file
        const userConfigPath = join( homedir(), '.aws-ag', 'config.json' );
        if ( existsSync( userConfigPath ) ) {
            try {
                const userConfig = JSON.parse( readFileSync( userConfigPath, 'utf-8' ) );
                config = this.mergeConfigs( config, userConfig );
                this.configSources.push( `user config (${userConfigPath})` );
            } catch ( error ) {
                console.warn( `Warning: Failed to load user config from ${userConfigPath}: ${error instanceof Error ? error.message : 'Unknown error'}` );
            }
        }

        // Try to load local config file
        const localConfigPath = join( process.cwd(), 'config.json' );
        if ( existsSync( localConfigPath ) ) {
            try {
                const localConfig = JSON.parse( readFileSync( localConfigPath, 'utf-8' ) );
                config = this.mergeConfigs( config, localConfig );
                this.configSources.push( `local config (${localConfigPath})` );
            } catch ( error ) {
                console.warn( `Warning: Failed to load local config from ${localConfigPath}: ${error instanceof Error ? error.message : 'Unknown error'}` );
            }
        }

        // Override with environment variables (highest priority)
        config = this.applyEnvironmentVariables( config );
        this.configSources.push( 'environment variables' );

        return config;
    }

    /**
     * Load environment files from multiple locations in priority order:
     * 1. User home directory (~/.aws-ag/.env)
     * 2. Current working directory (.env files)
     * 3. System environment variables
     *
     * Supports encrypted .env files via dotenvx
     */
    private loadEnvironmentFiles(): void {
        const envPaths = [
            // User-specific config directory (highest priority for global config)
            join( homedir(), '.aws-ag', '.env' ),
            // Current working directory (for project-specific configs)
            join( process.cwd(), '.env' ),
            join( process.cwd(), '.env.local' )
        ];

        // Load environment files in order (later files override earlier ones)
        for ( const envPath of envPaths ) {
            if ( existsSync( envPath ) ) {
                try {
                    // dotenvx automatically handles encrypted files if .env.keys is present
                    dotenvxConfig( {
                        path: envPath,
                        override: true // Allow later files to override earlier ones
                    } );
                    this.configSources.push( `env file (${envPath})` );

                    // Check if this is an encrypted file
                    const envContent = readFileSync( envPath, 'utf-8' );
                    if ( envContent.includes( 'DOTENV_PUBLIC_KEY' ) ) {
                        this.configSources.push( `encrypted env file (${envPath})` );
                    }
                } catch ( error ) {
                    console.warn( `Warning: Failed to load environment file ${envPath}: ${error instanceof Error ? error.message : 'Unknown error'}` );

                    // If it's an encrypted file, provide helpful error message
                    try {
                        const envContent = readFileSync( envPath, 'utf-8' );
                        if ( envContent.includes( 'DOTENV_PUBLIC_KEY' ) ) {
                            console.warn( `  This appears to be an encrypted .env file. Make sure .env.keys is available in the same directory.` );
                        }
                    } catch {
                        // Ignore read errors for error message enhancement
                    }
                }
            }
        }

        // System environment variables are automatically available via process.env
        // No need to call dotenvxConfig() without a file path as it causes unnecessary warnings
    }

    /**
     * Get default configuration values
     */
    private getDefaultConfig(): ToolConfig {
        return {
            azure: {
                tenantId: '',
                clientId: '',
                clientSecret: '',
                enterpriseApplicationId: ''
            },
            aws: {
                region: 'us-east-1',
                identityCenterInstanceArn: '',
                identityStoreId: '',
                accountMapping: {
                    Dev: '',
                    QA: '',
                    Staging: '',
                    Prod: ''
                }
            },
            logging: {
                level: 'info',
                enableConsole: true
            },
            retry: {
                maxAttempts: 3,
                baseDelayMs: 1000,
                maxDelayMs: 30000,
                exponentialBackoff: true
            },
            templates: {
                defaultSessionDuration: 'PT1H'
            }
        };
    }

    /**
     * Apply environment variables to configuration
     */
    private applyEnvironmentVariables( config: ToolConfig ): ToolConfig {
        const env = process.env;

        // Azure configuration
        if ( env.AZURE_TENANT_ID ) config.azure.tenantId = env.AZURE_TENANT_ID;
        if ( env.AZURE_CLIENT_ID ) config.azure.clientId = env.AZURE_CLIENT_ID;
        if ( env.AZURE_CLIENT_SECRET ) config.azure.clientSecret = env.AZURE_CLIENT_SECRET;
        if ( env.AZURE_ENTERPRISE_APP_ID ) config.azure.enterpriseApplicationId = env.AZURE_ENTERPRISE_APP_ID;

        // AWS configuration
        if ( env.AWS_REGION ) config.aws.region = env.AWS_REGION;
        if ( env.AWS_PROFILE ) config.aws.profile = env.AWS_PROFILE;
        if ( env.AWS_IDENTITY_CENTER_INSTANCE_ARN ) config.aws.identityCenterInstanceArn = env.AWS_IDENTITY_CENTER_INSTANCE_ARN;
        if ( env.AWS_IDENTITY_STORE_ID ) config.aws.identityStoreId = env.AWS_IDENTITY_STORE_ID;
        if ( env.AWS_ACCOUNT_DEV ) config.aws.accountMapping.Dev = env.AWS_ACCOUNT_DEV;
        if ( env.AWS_ACCOUNT_QA ) config.aws.accountMapping.QA = env.AWS_ACCOUNT_QA;
        if ( env.AWS_ACCOUNT_STAGING ) config.aws.accountMapping.Staging = env.AWS_ACCOUNT_STAGING;
        if ( env.AWS_ACCOUNT_PROD ) config.aws.accountMapping.Prod = env.AWS_ACCOUNT_PROD;

        // Logging configuration
        if ( env.LOG_LEVEL && [ 'debug', 'info', 'warn', 'error' ].includes( env.LOG_LEVEL ) ) {
            config.logging.level = env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error';
        }
        if ( env.LOG_FILE ) config.logging.file = env.LOG_FILE;
        if ( env.LOG_CONSOLE ) config.logging.enableConsole = env.LOG_CONSOLE.toLowerCase() === 'true';

        // Retry configuration
        if ( env.RETRY_MAX_ATTEMPTS ) {
            const maxAttempts = parseInt( env.RETRY_MAX_ATTEMPTS, 10 );
            if ( !isNaN( maxAttempts ) && maxAttempts > 0 ) {
                config.retry.maxAttempts = maxAttempts;
            }
        }
        if ( env.RETRY_BASE_DELAY_MS ) {
            const baseDelay = parseInt( env.RETRY_BASE_DELAY_MS, 10 );
            if ( !isNaN( baseDelay ) && baseDelay > 0 ) {
                config.retry.baseDelayMs = baseDelay;
            }
        }
        if ( env.RETRY_MAX_DELAY_MS ) {
            const maxDelay = parseInt( env.RETRY_MAX_DELAY_MS, 10 );
            if ( !isNaN( maxDelay ) && maxDelay > 0 ) {
                config.retry.maxDelayMs = maxDelay;
            }
        }
        if ( env.RETRY_EXPONENTIAL_BACKOFF ) {
            config.retry.exponentialBackoff = env.RETRY_EXPONENTIAL_BACKOFF.toLowerCase() === 'true';
        }

        // Template configuration
        if ( env.PERMISSION_SET_TEMPLATES_PATH ) config.templates.permissionSetTemplatesPath = env.PERMISSION_SET_TEMPLATES_PATH;
        if ( env.DEFAULT_SESSION_DURATION ) config.templates.defaultSessionDuration = env.DEFAULT_SESSION_DURATION;

        return config;
    }

    /**
     * Merge two configuration objects, with the second taking priority
     */
    private mergeConfigs( base: ToolConfig, override: Partial<ToolConfig> ): ToolConfig {
        return {
            azure: { ...base.azure, ...override.azure },
            aws: {
                ...base.aws,
                ...override.aws,
                accountMapping: { ...base.aws.accountMapping, ...override.aws?.accountMapping }
            },
            logging: { ...base.logging, ...override.logging },
            retry: { ...base.retry, ...override.retry },
            templates: { ...base.templates, ...override.templates }
        };
    }

    /**
     * Get the current configuration
     */
    getConfig(): ToolConfig {
        return { ...this.config };
    }

    /**
     * Get Azure configuration
     */
    getAzureConfig(): AzureConfig {
        return { ...this.config.azure };
    }

    /**
     * Get AWS configuration
     */
    getAWSConfig(): AWSConfig {
        return { ...this.config.aws };
    }

    /**
     * Get logging configuration
     */
    getLoggingConfig(): LoggingConfig {
        return { ...this.config.logging };
    }

    /**
     * Get retry configuration
     */
    getRetryConfig(): RetryConfig {
        return { ...this.config.retry };
    }

    /**
     * Validate the current configuration
     * Implements Requirements 5.4: Configuration validation
     */
    validateConfig(): ConfigValidationResult {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Required Azure configuration
        if ( !this.config.azure.tenantId ) {
            errors.push( 'Azure Tenant ID is required (AZURE_TENANT_ID)' );
        }
        if ( !this.config.azure.clientId ) {
            errors.push( 'Azure Client ID is required (AZURE_CLIENT_ID)' );
        }
        if ( !this.config.azure.clientSecret ) {
            errors.push( 'Azure Client Secret is required (AZURE_CLIENT_SECRET)' );
        }
        if ( !this.config.azure.enterpriseApplicationId ) {
            errors.push( 'Azure Enterprise Application ID is required (AZURE_ENTERPRISE_APP_ID)' );
        }

        // Required AWS configuration
        if ( !this.config.aws.identityCenterInstanceArn ) {
            errors.push( 'AWS Identity Center Instance ARN is required (AWS_IDENTITY_CENTER_INSTANCE_ARN)' );
        }
        if ( !this.config.aws.identityStoreId ) {
            errors.push( 'AWS Identity Store ID is required (AWS_IDENTITY_STORE_ID)' );
        }

        // AWS account mapping validation
        const accountTypes = [ 'Dev', 'QA', 'Staging', 'Prod' ] as const;
        for ( const accountType of accountTypes ) {
            if ( !this.config.aws.accountMapping[ accountType ] ) {
                errors.push( `AWS ${accountType} account ID is required (AWS_ACCOUNT_${accountType.toUpperCase()})` );
            } else {
                // Validate account ID format (12 digits)
                const accountId = this.config.aws.accountMapping[ accountType ];
                if ( !/^\d{12}$/.test( accountId ) ) {
                    errors.push( `AWS ${accountType} account ID must be 12 digits: ${accountId}` );
                }
            }
        }

        // Validate AWS region
        if ( !this.config.aws.region ) {
            warnings.push( 'AWS region not specified, using default: us-east-1' );
        }

        // Validate retry configuration
        if ( this.config.retry.maxAttempts < 1 ) {
            errors.push( 'Retry max attempts must be at least 1' );
        }
        if ( this.config.retry.baseDelayMs < 0 ) {
            errors.push( 'Retry base delay must be non-negative' );
        }
        if ( this.config.retry.maxDelayMs < this.config.retry.baseDelayMs ) {
            errors.push( 'Retry max delay must be greater than or equal to base delay' );
        }

        // Validate session duration format
        if ( this.config.templates.defaultSessionDuration &&
            !/^PT\d+[HM]$/.test( this.config.templates.defaultSessionDuration ) ) {
            errors.push( 'Default session duration must be in ISO 8601 format (e.g., PT1H, PT30M)' );
        }

        // Validate logging configuration
        if ( this.config.logging.file && !this.config.logging.enableConsole ) {
            warnings.push( 'Console logging is disabled but file logging is enabled' );
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Get configuration sources for debugging
     */
    getConfigSources(): string[] {
        return [ ...this.configSources ];
    }

    /**
     * Create a configuration template file
     */
    createConfigTemplate(): string {
        const template = {
            azure: {
                tenantId: "your-azure-tenant-id",
                clientId: "your-azure-client-id",
                clientSecret: "your-azure-client-secret",
                enterpriseApplicationId: "your-enterprise-app-id"
            },
            aws: {
                region: "us-east-1",
                profile: "default",
                identityCenterInstanceArn: "arn:aws:sso:::instance/ssoins-xxxxxxxxxx",
                identityStoreId: "d-xxxxxxxxxx",
                accountMapping: {
                    Dev: "123456789012",
                    QA: "123456789013",
                    Staging: "123456789014",
                    Prod: "123456789015"
                }
            },
            logging: {
                level: "info",
                enableConsole: true,
                file: "aws-ag.log"
            },
            retry: {
                maxAttempts: 3,
                baseDelayMs: 1000,
                maxDelayMs: 30000,
                exponentialBackoff: true
            },
            templates: {
                permissionSetTemplatesPath: "./templates",
                defaultSessionDuration: "PT1H"
            }
        };

        return JSON.stringify( template, null, 2 );
    }

    /**
     * Create environment variables template
     */
    createEnvTemplate(): string {
        return `# Azure AD Configuration
AZURE_TENANT_ID=your-azure-tenant-id
AZURE_CLIENT_ID=your-azure-client-id
AZURE_CLIENT_SECRET=your-azure-client-secret
AZURE_ENTERPRISE_APP_ID=your-enterprise-app-id

# AWS Configuration
AWS_REGION=us-east-1
AWS_PROFILE=default
AWS_IDENTITY_CENTER_INSTANCE_ARN=arn:aws:sso:::instance/ssoins-xxxxxxxxxx
AWS_IDENTITY_STORE_ID=d-xxxxxxxxxx

# AWS Account Mapping
AWS_ACCOUNT_DEV=123456789012
AWS_ACCOUNT_QA=123456789013
AWS_ACCOUNT_STAGING=123456789014
AWS_ACCOUNT_PROD=123456789015

# Logging Configuration (Optional)
LOG_LEVEL=info
LOG_FILE=aws-ag.log
LOG_CONSOLE=true

# Retry Configuration (Optional)
RETRY_MAX_ATTEMPTS=3
RETRY_BASE_DELAY_MS=1000
RETRY_MAX_DELAY_MS=30000
RETRY_EXPONENTIAL_BACKOFF=true

# Template Configuration (Optional)
PERMISSION_SET_TEMPLATES_PATH=./templates
DEFAULT_SESSION_DURATION=PT1H
`;
    }

    /**
     * Get masked configuration for safe logging/display
     */
    getMaskedConfig(): any {
        const masked = { ...this.config };

        // Mask sensitive values
        if ( masked.azure.clientSecret ) {
            masked.azure.clientSecret = '***masked***';
        }

        return masked;
    }

    /**
     * Setup user configuration directory and files
     */
    setupUserConfig(): { success: boolean; message: string; paths: string[] } {
        const userConfigDir = join( homedir(), '.aws-ag' );
        const userConfigFile = join( userConfigDir, 'config.json' );
        const userEnvFile = join( userConfigDir, '.env' );
        const userKeysFile = join( userConfigDir, '.env.keys' );
        const createdPaths: string[] = [];

        try {
            // Create user config directory
            if ( !existsSync( userConfigDir ) ) {
                mkdirSync( userConfigDir, { recursive: true } );
                createdPaths.push( userConfigDir );
            }

            // Create config.json template if it doesn't exist
            if ( !existsSync( userConfigFile ) ) {
                writeFileSync( userConfigFile, this.createConfigTemplate() );
                createdPaths.push( userConfigFile );
            }

            // Create .env template if it doesn't exist
            if ( !existsSync( userEnvFile ) ) {
                const envTemplate = this.createEnvTemplate();
                writeFileSync( userEnvFile, envTemplate );
                createdPaths.push( userEnvFile );
            }

            // Copy .env.keys from project if it exists and user doesn't have one
            if ( !existsSync( userKeysFile ) ) {
                const projectKeysFile = join( process.cwd(), '.env.keys' );
                if ( existsSync( projectKeysFile ) ) {
                    try {
                        const keysContent = readFileSync( projectKeysFile, 'utf-8' );
                        writeFileSync( userKeysFile, keysContent );
                        createdPaths.push( userKeysFile );
                    } catch ( error ) {
                        console.warn( `Warning: Could not copy .env.keys file: ${error instanceof Error ? error.message : 'Unknown error'}` );
                    }
                }
            }

            return {
                success: true,
                message: `User configuration directory setup complete at ${userConfigDir}`,
                paths: createdPaths
            };
        } catch ( error ) {
            return {
                success: false,
                message: `Failed to setup user configuration: ${error instanceof Error ? error.message : 'Unknown error'}`,
                paths: createdPaths
            };
        }
    }

    /**
     * Get information about encryption support and status
     */
    getEncryptionInfo(): {
        isSupported: boolean;
        userEnvEncrypted: boolean;
        projectEnvEncrypted: boolean;
        userKeysExists: boolean;
        projectKeysExists: boolean;
        userConfigDir: string;
    } {
        const userConfigDir = join( homedir(), '.aws-ag' );
        const userEnvFile = join( userConfigDir, '.env' );
        const userKeysFile = join( userConfigDir, '.env.keys' );
        const projectEnvFile = join( process.cwd(), '.env' );
        const projectKeysFile = join( process.cwd(), '.env.keys' );

        let userEnvEncrypted = false;
        let projectEnvEncrypted = false;

        // Check if user .env is encrypted
        if ( existsSync( userEnvFile ) ) {
            try {
                const content = readFileSync( userEnvFile, 'utf-8' );
                userEnvEncrypted = content.includes( 'DOTENV_PUBLIC_KEY' );
            } catch {
                // Ignore read errors
            }
        }

        // Check if project .env is encrypted
        if ( existsSync( projectEnvFile ) ) {
            try {
                const content = readFileSync( projectEnvFile, 'utf-8' );
                projectEnvEncrypted = content.includes( 'DOTENV_PUBLIC_KEY' );
            } catch {
                // Ignore read errors
            }
        }

        return {
            isSupported: true, // dotenvx always supports encryption
            userEnvEncrypted,
            projectEnvEncrypted,
            userKeysExists: existsSync( userKeysFile ),
            projectKeysExists: existsSync( projectKeysFile ),
            userConfigDir
        };
    }
}

// Export singleton instance
export const configManager = new ConfigManager();

// Export convenience functions
export const getConfig = () => configManager.getConfig();
export const getAzureConfig = () => configManager.getAzureConfig();
export const getAWSConfig = () => configManager.getAWSConfig();
export const getLoggingConfig = () => configManager.getLoggingConfig();
export const getRetryConfig = () => configManager.getRetryConfig();
export const validateConfig = () => configManager.validateConfig();
