// Permission Set Management - Templates and validation for AWS IAM Identity Center
import { PermissionSet } from '../types';
import { AWSClient } from '../clients/aws-client';

export interface PermissionSetTemplate {
    name: string;
    description: string;
    sessionDuration: string;
    managedPolicies: string[];
    inlinePolicy?: string;
    tags: Record<string, string>;
}

export interface CustomPermissionSetRequest {
    name: string;
    description?: string;
    sessionDuration?: string;
    managedPolicies?: string[];
    inlinePolicy?: string;
    tags?: Record<string, string>;
}

export interface PermissionSetValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

/**
 * Permission Set Manager - Handles templates, creation, and validation
 * Implements Requirements 2.2, 2.3, 2.4: Permission set management and validation
 */
export class PermissionSetManager {
    private awsClient: AWSClient;
    private templates: Map<string, PermissionSetTemplate> = new Map();

    constructor( awsClient: AWSClient ) {
        this.awsClient = awsClient;
        this.initializeTemplates();
    }

    /**
     * Initialize common permission set templates
     * Implements Requirements 2.3: Provide templates based on common access patterns
     */
    private initializeTemplates(): void {
        // Read-only access template
        this.templates.set( 'readonly', {
            name: 'ReadOnlyAccess',
            description: 'Provides read-only access to AWS resources',
            sessionDuration: 'PT4H',
            managedPolicies: [
                'arn:aws:iam::aws:policy/ReadOnlyAccess'
            ],
            tags: {
                'Template': 'readonly',
                'AccessLevel': 'read'
            }
        } );

        // Developer access template
        this.templates.set( 'developer', {
            name: 'DeveloperAccess',
            description: 'Provides developer access with common development permissions',
            sessionDuration: 'PT8H',
            managedPolicies: [
                'arn:aws:iam::aws:policy/PowerUserAccess'
            ],
            tags: {
                'Template': 'developer',
                'AccessLevel': 'power-user'
            }
        } );

        // Admin access template
        this.templates.set( 'admin', {
            name: 'AdministratorAccess',
            description: 'Provides full administrative access to AWS resources',
            sessionDuration: 'PT2H',
            managedPolicies: [
                'arn:aws:iam::aws:policy/AdministratorAccess'
            ],
            tags: {
                'Template': 'admin',
                'AccessLevel': 'admin'
            }
        } );

        // S3 access template
        this.templates.set( 's3-access', {
            name: 'S3Access',
            description: 'Provides access to S3 buckets and objects',
            sessionDuration: 'PT4H',
            managedPolicies: [
                'arn:aws:iam::aws:policy/AmazonS3FullAccess'
            ],
            tags: {
                'Template': 's3-access',
                'AccessLevel': 'service-specific'
            }
        } );

        // EC2 access template
        this.templates.set( 'ec2-access', {
            name: 'EC2Access',
            description: 'Provides access to EC2 instances and related services',
            sessionDuration: 'PT4H',
            managedPolicies: [
                'arn:aws:iam::aws:policy/AmazonEC2FullAccess'
            ],
            tags: {
                'Template': 'ec2-access',
                'AccessLevel': 'service-specific'
            }
        } );

        // Lambda developer template
        this.templates.set( 'lambda-developer', {
            name: 'LambdaDeveloper',
            description: 'Provides access for Lambda function development and deployment',
            sessionDuration: 'PT6H',
            managedPolicies: [
                'arn:aws:iam::aws:policy/AWSLambda_FullAccess',
                'arn:aws:iam::aws:policy/IAMReadOnlyAccess',
                'arn:aws:iam::aws:policy/CloudWatchLogsReadOnlyAccess'
            ],
            tags: {
                'Template': 'lambda-developer',
                'AccessLevel': 'developer'
            }
        } );

        // Database admin template
        this.templates.set( 'database-admin', {
            name: 'DatabaseAdmin',
            description: 'Provides access to RDS and DynamoDB services',
            sessionDuration: 'PT4H',
            managedPolicies: [
                'arn:aws:iam::aws:policy/AmazonRDSFullAccess',
                'arn:aws:iam::aws:policy/AmazonDynamoDBFullAccess'
            ],
            tags: {
                'Template': 'database-admin',
                'AccessLevel': 'service-specific'
            }
        } );

        // Security auditor template
        this.templates.set( 'security-auditor', {
            name: 'SecurityAuditor',
            description: 'Provides read-only access for security auditing',
            sessionDuration: 'PT2H',
            managedPolicies: [
                'arn:aws:iam::aws:policy/SecurityAudit',
                'arn:aws:iam::aws:policy/ReadOnlyAccess'
            ],
            tags: {
                'Template': 'security-auditor',
                'AccessLevel': 'audit'
            }
        } );

        // Billing access template
        this.templates.set( 'billing-access', {
            name: 'BillingAccess',
            description: 'Provides access to billing and cost management',
            sessionDuration: 'PT4H',
            managedPolicies: [
                'arn:aws:iam::aws:policy/job-function/Billing'
            ],
            tags: {
                'Template': 'billing-access',
                'AccessLevel': 'billing'
            }
        } );
    }

    /**
     * Get all available permission set templates
     * Implements Requirements 2.3: Display templates based on common access patterns
     */
    getAvailableTemplates(): PermissionSetTemplate[] {
        return Array.from( this.templates.values() );
    }

    /**
     * Get a specific template by name
     */
    getTemplate( templateName: string ): PermissionSetTemplate | undefined {
        return this.templates.get( templateName );
    }

    /**
     * Create a permission set from a template
     * Implements Requirements 2.2: Guide creation of new permission sets
     */
    async createFromTemplate(
        templateName: string,
        customizations?: Partial<PermissionSetTemplate>
    ): Promise<PermissionSet> {
        const template = this.templates.get( templateName );
        if ( !template ) {
            throw new Error( `Template '${templateName}' not found` );
        }

        // Merge template with customizations
        const finalConfig: PermissionSetTemplate = {
            ...template,
            ...customizations,
            tags: {
                ...template.tags,
                ...customizations?.tags
            }
        };

        // Validate the configuration
        const validation = await this.validatePermissionSetConfig( finalConfig );
        if ( !validation.isValid ) {
            throw new Error( `Permission set validation failed: ${validation.errors.join( ', ' )}` );
        }

        // Create the permission set
        const permissionSet = await this.awsClient.createPermissionSet(
            finalConfig.name,
            finalConfig.description,
            finalConfig.sessionDuration
        );

        // Attach managed policies
        for ( const policyArn of finalConfig.managedPolicies ) {
            await this.awsClient.attachManagedPolicyToPermissionSet( permissionSet.arn, policyArn );
        }

        // Add inline policy if provided
        if ( finalConfig.inlinePolicy ) {
            await this.awsClient.putInlinePolicyToPermissionSet( permissionSet.arn, finalConfig.inlinePolicy );
        }

        return {
            ...permissionSet,
            managedPolicies: finalConfig.managedPolicies,
            inlinePolicy: finalConfig.inlinePolicy,
            tags: finalConfig.tags
        };
    }

    /**
     * Create a custom permission set
     * Implements Requirements 2.2: Custom permission set creation workflow
     */
    async createCustomPermissionSet( request: CustomPermissionSetRequest ): Promise<PermissionSet> {
        // Set defaults
        const config: PermissionSetTemplate = {
            name: request.name,
            description: request.description || `Custom permission set: ${request.name}`,
            sessionDuration: request.sessionDuration || 'PT1H',
            managedPolicies: request.managedPolicies || [],
            inlinePolicy: request.inlinePolicy,
            tags: {
                'CreatedBy': 'aws-ag-tool',
                'Type': 'custom',
                ...request.tags
            }
        };

        // Validate the configuration
        const validation = await this.validatePermissionSetConfig( config );
        if ( !validation.isValid ) {
            throw new Error( `Permission set validation failed: ${validation.errors.join( ', ' )}` );
        }

        // Create the permission set
        const permissionSet = await this.awsClient.createPermissionSet(
            config.name,
            config.description,
            config.sessionDuration
        );

        // Attach managed policies
        for ( const policyArn of config.managedPolicies ) {
            await this.awsClient.attachManagedPolicyToPermissionSet( permissionSet.arn, policyArn );
        }

        // Add inline policy if provided
        if ( config.inlinePolicy ) {
            await this.awsClient.putInlinePolicyToPermissionSet( permissionSet.arn, config.inlinePolicy );
        }

        return {
            ...permissionSet,
            managedPolicies: config.managedPolicies,
            inlinePolicy: config.inlinePolicy,
            tags: config.tags
        };
    }

    /**
     * Validate permission set configuration
     * Implements Requirements 2.4: Validate that permission sets contain appropriate policies and permissions
     */
    async validatePermissionSetConfig( config: PermissionSetTemplate ): Promise<PermissionSetValidationResult> {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Validate name
        if ( !config.name || config.name.trim().length === 0 ) {
            errors.push( 'Permission set name is required' );
        } else if ( config.name.length > 32 ) {
            errors.push( 'Permission set name must be 32 characters or less' );
        } else if ( !/^[a-zA-Z0-9+=,.@_-]+$/.test( config.name ) ) {
            errors.push( 'Permission set name contains invalid characters' );
        }

        // Validate session duration
        if ( config.sessionDuration ) {
            if ( !this.isValidSessionDuration( config.sessionDuration ) ) {
                errors.push( 'Invalid session duration format. Use ISO 8601 duration format (e.g., PT1H, PT4H)' );
            } else {
                const durationMinutes = this.parseDurationToMinutes( config.sessionDuration );
                if ( durationMinutes < 15 ) {
                    errors.push( 'Session duration must be at least 15 minutes' );
                } else if ( durationMinutes > 720 ) {
                    errors.push( 'Session duration cannot exceed 12 hours (720 minutes)' );
                }
            }
        }

        // Validate managed policies
        for ( const policyArn of config.managedPolicies ) {
            if ( !this.isValidPolicyArn( policyArn ) ) {
                errors.push( `Invalid managed policy ARN: ${policyArn}` );
            }
        }

        // Validate inline policy
        if ( config.inlinePolicy ) {
            const policyValidation = this.validateInlinePolicy( config.inlinePolicy );
            if ( !policyValidation.isValid ) {
                errors.push( `Invalid inline policy: ${policyValidation.error}` );
            }
        }

        // Check for overly permissive policies
        const adminPolicies = config.managedPolicies.filter( arn =>
            arn.includes( 'AdministratorAccess' ) || arn.includes( 'PowerUserAccess' )
        );
        if ( adminPolicies.length > 0 ) {
            warnings.push( `Permission set includes highly privileged policies: ${adminPolicies.join( ', ' )}` );
        }

        // Check for empty permission set
        if ( config.managedPolicies.length === 0 && !config.inlinePolicy ) {
            warnings.push( 'Permission set has no policies attached - users will have no permissions' );
        }

        // Validate tags
        for ( const [ key, value ] of Object.entries( config.tags ) ) {
            if ( key.length > 128 ) {
                errors.push( `Tag key '${key}' exceeds 128 characters` );
            }
            if ( value.length > 256 ) {
                errors.push( `Tag value for key '${key}' exceeds 256 characters` );
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Validate existing permission set
     */
    async validateExistingPermissionSet( permissionSetArn: string ): Promise<PermissionSetValidationResult> {
        try {
            // Get permission set details from AWS
            const permissionSets = await this.awsClient.listPermissionSets();
            const permissionSet = permissionSets.find( ps => ps.arn === permissionSetArn );

            if ( !permissionSet ) {
                return {
                    isValid: false,
                    errors: [ 'Permission set not found' ],
                    warnings: []
                };
            }

            // Convert to template format for validation
            const config: PermissionSetTemplate = {
                name: permissionSet.name,
                description: permissionSet.description || '',
                sessionDuration: permissionSet.sessionDuration,
                managedPolicies: permissionSet.managedPolicies,
                inlinePolicy: permissionSet.inlinePolicy,
                tags: permissionSet.tags
            };

            return await this.validatePermissionSetConfig( config );

        } catch ( error ) {
            return {
                isValid: false,
                errors: [ `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` ],
                warnings: []
            };
        }
    }

    /**
     * Get permission set recommendations based on group name or description
     */
    getRecommendedTemplates( groupName: string, groupDescription?: string ): string[] {
        const text = `${groupName} ${groupDescription || ''}`.toLowerCase();
        const recommendations: string[] = [];

        // Simple keyword matching for recommendations
        if ( text.includes( 'admin' ) || text.includes( 'administrator' ) ) {
            recommendations.push( 'admin' );
        }
        if ( text.includes( 'developer' ) || text.includes( 'dev' ) ) {
            recommendations.push( 'developer', 'lambda-developer' );
        }
        if ( text.includes( 'read' ) || text.includes( 'view' ) || text.includes( 'audit' ) ) {
            recommendations.push( 'readonly', 'security-auditor' );
        }
        if ( text.includes( 's3' ) || text.includes( 'storage' ) ) {
            recommendations.push( 's3-access' );
        }
        if ( text.includes( 'ec2' ) || text.includes( 'compute' ) ) {
            recommendations.push( 'ec2-access' );
        }
        if ( text.includes( 'database' ) || text.includes( 'db' ) || text.includes( 'rds' ) || text.includes( 'dynamo' ) ) {
            recommendations.push( 'database-admin' );
        }
        if ( text.includes( 'billing' ) || text.includes( 'cost' ) || text.includes( 'finance' ) ) {
            recommendations.push( 'billing-access' );
        }
        if ( text.includes( 'security' ) || text.includes( 'compliance' ) ) {
            recommendations.push( 'security-auditor' );
        }

        // Remove duplicates and return
        return [ ...new Set( recommendations ) ];
    }

    /**
     * Validate session duration format
     */
    private isValidSessionDuration( duration: string ): boolean {
        // ISO 8601 duration format: PT[n]H[n]M[n]S
        const durationRegex = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
        return durationRegex.test( duration );
    }

    /**
     * Parse ISO 8601 duration to minutes
     */
    private parseDurationToMinutes( duration: string ): number {
        const durationRegex = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/;
        const match = duration.match( durationRegex );

        if ( !match ) return 0;

        const hours = parseInt( match[ 1 ] || '0', 10 );
        const minutes = parseInt( match[ 2 ] || '0', 10 );
        const seconds = parseInt( match[ 3 ] || '0', 10 );

        return hours * 60 + minutes + Math.ceil( seconds / 60 );
    }

    /**
     * Validate policy ARN format
     */
    private isValidPolicyArn( arn: string ): boolean {
        // AWS managed policy ARN format
        const awsManagedPolicyRegex = /^arn:aws:iam::aws:policy\/[a-zA-Z0-9+=,.@_/-]+$/;
        // Customer managed policy ARN format
        const customerManagedPolicyRegex = /^arn:aws:iam::\d{12}:policy\/[a-zA-Z0-9+=,.@_/-]+$/;

        return awsManagedPolicyRegex.test( arn ) || customerManagedPolicyRegex.test( arn );
    }

    /**
     * Basic inline policy validation
     */
    private validateInlinePolicy( policy: string ): { isValid: boolean; error?: string } {
        try {
            const parsed = JSON.parse( policy );

            // Basic structure validation
            if ( !parsed.Version ) {
                return { isValid: false, error: 'Policy must include Version field' };
            }

            if ( !parsed.Statement || !Array.isArray( parsed.Statement ) ) {
                return { isValid: false, error: 'Policy must include Statement array' };
            }

            // Validate each statement has required fields
            for ( const statement of parsed.Statement ) {
                if ( !statement.Effect || ![ 'Allow', 'Deny' ].includes( statement.Effect ) ) {
                    return { isValid: false, error: 'Each statement must have Effect of Allow or Deny' };
                }
                if ( !statement.Action && !statement.NotAction ) {
                    return { isValid: false, error: 'Each statement must have Action or NotAction' };
                }
            }

            return { isValid: true };

        } catch ( error ) {
            return { isValid: false, error: 'Policy must be valid JSON' };
        }
    }

    /**
     * List existing permission sets
     */
    async listExistingPermissionSets(): Promise<PermissionSet[]> {
        return await this.awsClient.listPermissionSets();
    }

    /**
     * Check if permission set name already exists
     */
    async permissionSetExists( name: string ): Promise<boolean> {
        try {
            const existingPermissionSets = await this.awsClient.listPermissionSets();
            return existingPermissionSets.some( ps => ps.name === name );
        } catch ( error ) {
            throw new Error( `Failed to check permission set existence: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Generate unique permission set name
     */
    async generateUniquePermissionSetName( baseName: string ): Promise<string> {
        let counter = 1;
        let candidateName = baseName;

        while ( await this.permissionSetExists( candidateName ) ) {
            candidateName = `${baseName}-${counter}`;
            counter++;
        }

        return candidateName;
    }
}
