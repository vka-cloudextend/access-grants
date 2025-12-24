// Tests for Configuration Management
import { ConfigManager } from './index';

// Store original environment to restore after tests
const originalEnv = { ...process.env };

describe( 'ConfigManager', () => {
    let configManager: ConfigManager;

    beforeEach( () => {
        // Reset environment to original state first
        Object.keys( process.env ).forEach( key => {
            if ( !originalEnv.hasOwnProperty( key ) ) {
                delete process.env[ key ];
            }
        } );
        Object.assign( process.env, originalEnv );

        // Clear all environment variables that could affect config validation
        delete process.env.AZURE_TENANT_ID;
        delete process.env.AZURE_CLIENT_ID;
        delete process.env.AZURE_CLIENT_SECRET;
        delete process.env.AZURE_ENTERPRISE_APP_ID;
        delete process.env.AWS_REGION;
        delete process.env.AWS_IDENTITY_CENTER_INSTANCE_ARN;
        delete process.env.AWS_IDENTITY_STORE_ID;
        delete process.env.AWS_ACCOUNT_DEV;
        delete process.env.AWS_ACCOUNT_QA;
        delete process.env.AWS_ACCOUNT_STAGING;
        delete process.env.AWS_ACCOUNT_PROD;
        delete process.env.AWS_PROFILE;

        configManager = new ConfigManager( { skipEnvLoad: true } );
    } );

    afterEach( () => {
        // Restore original environment after each test
        Object.keys( process.env ).forEach( key => {
            if ( !originalEnv.hasOwnProperty( key ) ) {
                delete process.env[ key ];
            }
        } );
        Object.assign( process.env, originalEnv );
    } );

    describe( 'validateConfig', () => {
        test( 'should return invalid when required Azure config is missing', () => {
            const validation = configManager.validateConfig();

            expect( validation.isValid ).toBe( false );
            expect( validation.errors ).toContain( 'Azure Tenant ID is required (AZURE_TENANT_ID)' );
            expect( validation.errors ).toContain( 'Azure Client ID is required (AZURE_CLIENT_ID)' );
            expect( validation.errors ).toContain( 'Azure Client Secret is required (AZURE_CLIENT_SECRET)' );
            expect( validation.errors ).toContain( 'Azure Enterprise Application ID is required (AZURE_ENTERPRISE_APP_ID)' );
        } );

        test( 'should return invalid when required AWS config is missing', () => {
            const validation = configManager.validateConfig();

            expect( validation.isValid ).toBe( false );
            expect( validation.errors ).toContain( 'AWS Identity Center Instance ARN is required (AWS_IDENTITY_CENTER_INSTANCE_ARN)' );
            expect( validation.errors ).toContain( 'AWS Identity Store ID is required (AWS_IDENTITY_STORE_ID)' );
            expect( validation.errors ).toContain( 'AWS Dev account ID is required (AWS_ACCOUNT_DEV)' );
            expect( validation.errors ).toContain( 'AWS QA account ID is required (AWS_ACCOUNT_QA)' );
            expect( validation.errors ).toContain( 'AWS Staging account ID is required (AWS_ACCOUNT_STAGING)' );
            expect( validation.errors ).toContain( 'AWS Prod account ID is required (AWS_ACCOUNT_PROD)' );
        } );

        test( 'should validate AWS account ID format', () => {
            // Set all required config except account IDs
            process.env.AZURE_TENANT_ID = 'test-tenant';
            process.env.AZURE_CLIENT_ID = 'test-client';
            process.env.AZURE_CLIENT_SECRET = 'test-secret';
            process.env.AZURE_ENTERPRISE_APP_ID = 'test-app';
            process.env.AWS_IDENTITY_CENTER_INSTANCE_ARN = 'arn:aws:sso:::instance/ssoins-test';
            process.env.AWS_IDENTITY_STORE_ID = 'd-test';
            process.env.AWS_ACCOUNT_DEV = 'invalid-account-id';
            process.env.AWS_ACCOUNT_QA = '123456789012';
            process.env.AWS_ACCOUNT_STAGING = '123456789013';
            process.env.AWS_ACCOUNT_PROD = '123456789014';

            configManager = new ConfigManager( { skipEnvLoad: true } );
            const validation = configManager.validateConfig();

            expect( validation.isValid ).toBe( false );
            expect( validation.errors ).toContain( 'AWS Dev account ID must be 12 digits: invalid-account-id' );
        } );

        test( 'should return valid when all required config is provided', () => {
            // Set all required environment variables
            process.env.AZURE_TENANT_ID = 'test-tenant';
            process.env.AZURE_CLIENT_ID = 'test-client';
            process.env.AZURE_CLIENT_SECRET = 'test-secret';
            process.env.AZURE_ENTERPRISE_APP_ID = 'test-app';
            process.env.AWS_REGION = 'us-east-1';
            process.env.AWS_IDENTITY_CENTER_INSTANCE_ARN = 'arn:aws:sso:::instance/ssoins-test';
            process.env.AWS_IDENTITY_STORE_ID = 'd-test';
            process.env.AWS_ACCOUNT_DEV = '123456789012';
            process.env.AWS_ACCOUNT_QA = '123456789013';
            process.env.AWS_ACCOUNT_STAGING = '123456789014';
            process.env.AWS_ACCOUNT_PROD = '123456789015';

            configManager = new ConfigManager( { skipEnvLoad: true } );
            const validation = configManager.validateConfig();

            expect( validation.isValid ).toBe( true );
            expect( validation.errors ).toHaveLength( 0 );
        } );
    } );

    describe( 'createConfigTemplate', () => {
        test( 'should create valid JSON template', () => {
            const template = configManager.createConfigTemplate();

            expect( () => JSON.parse( template ) ).not.toThrow();

            const parsed = JSON.parse( template );
            expect( parsed ).toHaveProperty( 'azure' );
            expect( parsed ).toHaveProperty( 'aws' );
            expect( parsed ).toHaveProperty( 'logging' );
            expect( parsed ).toHaveProperty( 'retry' );
            expect( parsed ).toHaveProperty( 'templates' );
        } );
    } );

    describe( 'createEnvTemplate', () => {
        test( 'should create environment variables template', () => {
            const template = configManager.createEnvTemplate();

            expect( template ).toContain( 'AZURE_TENANT_ID=' );
            expect( template ).toContain( 'AZURE_CLIENT_ID=' );
            expect( template ).toContain( 'AWS_REGION=' );
            expect( template ).toContain( 'AWS_ACCOUNT_DEV=' );
        } );
    } );

    describe( 'getMaskedConfig', () => {
        test( 'should mask sensitive values', () => {
            process.env.AZURE_CLIENT_SECRET = 'super-secret-value';

            configManager = new ConfigManager( { skipEnvLoad: true } );
            const masked = configManager.getMaskedConfig();

            expect( masked.azure.clientSecret ).toBe( '***masked***' );
        } );
    } );
} );
