#!/usr/bin/env node

/**
 * AWS Access Grants - Configuration Validation Script
 *
 * This script helps validate your configuration step by step
 * Run with: node validate-setup.js
 */

const { execSync } = require( 'child_process' );
const fs = require( 'fs' );

console.log( '🔍 AWS Access Grants - Configuration Validation' );
console.log( '='.repeat( 50 ) );

// Check if .env file exists
if ( !fs.existsSync( '.env' ) ) {
    console.log( '❌ .env file not found' );
    console.log( '💡 Run: node dist/cli.js config --env-template > .env' );
    process.exit( 1 );
}

console.log( '✅ .env file found' );

// Load environment variables
require( '@dotenvx/dotenvx' ).config();

// Check required environment variables
const requiredVars = [
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET',
    'AZURE_ENTERPRISE_APP_ID',
    'AWS_REGION',
    'AWS_IDENTITY_CENTER_INSTANCE_ARN',
    'AWS_IDENTITY_STORE_ID',
    'AWS_ACCOUNT_DEV',
    'AWS_ACCOUNT_QA',
    'AWS_ACCOUNT_STAGING',
    'AWS_ACCOUNT_PROD'
];

console.log( '\n📋 Checking required environment variables...' );
let missingVars = [];

requiredVars.forEach( varName => {
    const value = process.env[ varName ];
    if ( !value || value.includes( 'your-' ) || value.includes( 'xxxxxxxxxx' ) || value.includes( '123456789012' ) ) {
        console.log( `❌ ${varName}: Not configured or using placeholder value` );
        missingVars.push( varName );
    } else {
        console.log( `✅ ${varName}: Configured` );
    }
} );

// Check optional AWS profile
const awsProfile = process.env.AWS_PROFILE;
if ( awsProfile ) {
    console.log( `✅ AWS_PROFILE: ${awsProfile} (using AWS profile)` );
} else {
    console.log( `ℹ️  AWS_PROFILE: Not set (will use default AWS credentials)` );
}

if ( missingVars.length > 0 ) {
    console.log( `\n❌ ${missingVars.length} variables need to be configured:` );
    missingVars.forEach( varName => {
        console.log( `   - ${varName}` );
    } );
    console.log( '\n💡 Please update your .env file with actual values' );
    console.log( '📖 See SETUP_GUIDE.md for detailed instructions' );
    process.exit( 1 );
}

console.log( '\n✅ All required environment variables are configured' );

// Test CLI configuration validation
console.log( '\n🔧 Testing CLI configuration validation...' );
try {
    execSync( 'node dist/cli.js config --validate', { stdio: 'inherit' } );
    console.log( '✅ CLI configuration validation passed' );
} catch ( error ) {
    console.log( '❌ CLI configuration validation failed' );
    console.log( '💡 Check the error messages above and update your .env file' );
    process.exit( 1 );
}

// Test Azure AD connection
console.log( '\n🔗 Testing Azure AD connection...' );
try {
    const result = execSync( 'node dist/cli.js discover-groups --format json', {
        stdio: 'pipe',
        timeout: 60000, // Increased timeout to 60 seconds
        encoding: 'utf8'
    } );

    // Extract JSON from the output (skip dotenvx log lines)
    const lines = result.split( '\n' );
    const jsonStartIndex = lines.findIndex( line => line.trim().startsWith( '[' ) );

    if ( jsonStartIndex !== -1 ) {
        // Join all lines from the JSON start to create the complete JSON
        const jsonLines = lines.slice( jsonStartIndex );
        const jsonString = jsonLines.join( '\n' );

        try {
            const groups = JSON.parse( jsonString );
            if ( Array.isArray( groups ) ) {
                console.log( '✅ Azure AD connection successful' );
            } else {
                console.log( '❌ Azure AD connection failed - invalid response format' );
            }
        } catch ( parseError ) {
            console.log( '❌ Azure AD connection failed - JSON parse error' );
            console.log( '🔍 Parse error:', parseError.message );
        }
    } else {
        console.log( '❌ Azure AD connection failed - no JSON output found' );
    }
} catch ( error ) {
    console.log( '❌ Azure AD connection failed' );
    if ( error.message.includes( 'ETIMEDOUT' ) ) {
        console.log( '💡 Connection timed out - Azure AD might be slow to respond' );
        console.log( '💡 Try running: node dist/cli.js discover-groups' );
    } else {
        console.log( '💡 Check your Azure AD credentials and permissions' );
    }
    console.log( '📖 See SETUP_GUIDE.md section "Azure AD Configuration"' );
}

// Test AWS connection
console.log( '\n☁️  Testing AWS connection...' );
try {
    execSync( 'node dist/cli.js list-permission-sets --format json', {
        stdio: 'pipe',
        timeout: 30000
    } );
    console.log( '✅ AWS connection successful' );
} catch ( error ) {
    console.log( '❌ AWS connection failed' );
    console.log( '💡 Check your AWS credentials and permissions' );
    console.log( '📖 See SETUP_GUIDE.md section "AWS Configuration"' );
}

// Test system health
console.log( '\n🏥 Testing system health...' );
try {
    execSync( 'node dist/cli.js health --format json', {
        stdio: 'pipe',
        timeout: 30000
    } );
    console.log( '✅ System health check passed' );
} catch ( error ) {
    console.log( '⚠️  System health check completed with warnings' );
    console.log( '💡 This is normal if some services are not fully configured' );
}

console.log( '\n🎉 Configuration validation completed!' );
console.log( '\n📋 Next steps:' );
console.log( '1. Try: node dist/cli.js discover-groups' );
console.log( '2. Try: node dist/cli.js list-permission-sets' );
console.log( '3. Try: node dist/cli.js create-access --help' );
console.log( '4. Read: SETUP_GUIDE.md for detailed usage instructions' );
