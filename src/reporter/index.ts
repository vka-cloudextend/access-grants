// Configuration Reporter - Comprehensive reporting and audit functionality
import * as fs from 'fs/promises';
import * as path from 'path';
import { AWSClient } from '../clients/aws-client';
import { AzureClient } from '../clients/azure-client';
import { AssignmentOperation, GroupAssignment, PermissionSet } from '../types';

export interface AssignmentSummary {
    totalAssignments: number;
    activeAssignments: number;
    failedAssignments: number;
    pendingAssignments: number;
    assignmentsByAccount: Record<string, number>;
    assignmentsByPermissionSet: Record<string, number>;
    recentOperations: AssignmentOperation[];
    lastUpdated: Date;
}

export interface AuditLogEntry {
    timestamp: Date;
    operationId: string;
    operationType: 'CREATE' | 'DELETE' | 'UPDATE' | 'VALIDATE';
    userId?: string;
    details: Record<string, unknown>;
    result: 'SUCCESS' | 'FAILURE' | 'PARTIAL';
    errorMessage?: string;
}

export interface ConfigurationExport {
    metadata: {
        exportDate: Date;
        version: string;
        source: string;
    };
    azureConfiguration: {
        tenantId: string;
        enterpriseApplicationId: string;
        groups: Array<{
            id: string;
            displayName: string;
            description?: string;
            memberCount: number;
        }>;
    };
    awsConfiguration: {
        region: string;
        identityCenterInstanceArn: string;
        identityStoreId: string;
        permissionSets: PermissionSet[];
        accounts: Array<{
            accountId: string;
            accountName: string;
            status: string;
        }>;
    };
    assignments: GroupAssignment[];
    operations: AssignmentOperation[];
}

export class ConfigurationReporter {
    private azureClient: AzureClient;
    private awsClient: AWSClient;
    private auditLog: AuditLogEntry[] = [];
    private operationHistory: Map<string, AssignmentOperation> = new Map();

    constructor( azureClient: AzureClient, awsClient: AWSClient ) {
        this.azureClient = azureClient;
        this.awsClient = awsClient;
    }

    /**
     * Generate comprehensive assignment summary
     * Implements Requirements 5.1: Display current group-to-permission mappings across all AWS accounts
     */
    async generateAssignmentSummary(): Promise<AssignmentSummary> {
        try {
            // Get all current assignments
            const assignments = await this.awsClient.listAccountAssignments();

            // Calculate statistics
            const totalAssignments = assignments.length;
            const activeAssignments = assignments.filter( a => a.status === 'PROVISIONED' ).length;
            const failedAssignments = assignments.filter( a => a.status === 'FAILED' ).length;
            const pendingAssignments = assignments.filter( a => a.status === 'IN_PROGRESS' ).length;

            // Group by account
            const assignmentsByAccount: Record<string, number> = {};
            for ( const assignment of assignments ) {
                assignmentsByAccount[ assignment.accountId ] = ( assignmentsByAccount[ assignment.accountId ] || 0 ) + 1;
            }

            // Group by permission set
            const assignmentsByPermissionSet: Record<string, number> = {};
            for ( const assignment of assignments ) {
                const psName = assignment.permissionSetArn.split( '/' ).pop() || assignment.permissionSetArn;
                assignmentsByPermissionSet[ psName ] = ( assignmentsByPermissionSet[ psName ] || 0 ) + 1;
            }

            // Get recent operations (last 10)
            const recentOperations = Array.from( this.operationHistory.values() )
                .sort( ( a, b ) => b.startTime.getTime() - a.startTime.getTime() )
                .slice( 0, 10 );

            return {
                totalAssignments,
                activeAssignments,
                failedAssignments,
                pendingAssignments,
                assignmentsByAccount,
                assignmentsByPermissionSet,
                recentOperations,
                lastUpdated: new Date()
            };
        } catch ( error ) {
            throw new Error( `Failed to generate assignment summary: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Export complete configuration for backup/replication
     * Implements Requirements 5.4: Create configuration files for backup or replication
     */
    async exportConfiguration(): Promise<ConfigurationExport> {
        try {
            // Get Azure configuration
            const azureGroups = await this.azureClient.listSecurityGroups();

            // Get AWS configuration
            const permissionSets = await this.awsClient.listPermissionSets();
            const accounts = await this.awsClient.listOrganizationAccounts();
            const assignments = await this.awsClient.listAccountAssignments();

            // Convert assignments to GroupAssignment format
            const groupAssignments: GroupAssignment[] = assignments.map( a => ( {
                azureGroupId: a.principalId,
                azureGroupName: '', // Would need to be populated from Azure
                awsAccountId: a.accountId,
                permissionSetArn: a.permissionSetArn,
                assignmentStatus: a.status === 'PROVISIONED' ? 'ACTIVE' :
                    a.status === 'FAILED' ? 'FAILED' : 'PENDING',
                createdDate: new Date() // Would need to be tracked separately
            } ) );

            const config: ConfigurationExport = {
                metadata: {
                    exportDate: new Date(),
                    version: '1.0.0',
                    source: 'aws-azure-sso-tool'
                },
                azureConfiguration: {
                    tenantId: '', // Would need to be provided from config
                    enterpriseApplicationId: '', // Would need to be provided from config
                    groups: azureGroups.map( g => ( {
                        id: g.id,
                        displayName: g.displayName,
                        description: g.description,
                        memberCount: g.memberCount
                    } ) )
                },
                awsConfiguration: {
                    region: '', // Would need to be provided from config
                    identityCenterInstanceArn: '', // Would need to be provided from config
                    identityStoreId: '', // Would need to be provided from config
                    permissionSets,
                    accounts
                },
                assignments: groupAssignments,
                operations: Array.from( this.operationHistory.values() )
            };

            return config;
        } catch ( error ) {
            throw new Error( `Failed to export configuration: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Log operation for audit trail
     * Implements Requirements 5.2, 8.3: Maintain operation history and ensure proper logging
     */
    async logOperation( operation: AssignmentOperation ): Promise<void> {
        try {
            // Store operation in history
            this.operationHistory.set( operation.operationId, operation );

            // Create audit log entry
            const auditEntry: AuditLogEntry = {
                timestamp: operation.startTime,
                operationId: operation.operationId,
                operationType: operation.operationType,
                details: {
                    assignments: operation.assignments,
                    status: operation.status,
                    errors: operation.errors
                },
                result: operation.status === 'COMPLETED' ? 'SUCCESS' :
                    operation.status === 'FAILED' ? 'FAILURE' : 'PARTIAL',
                errorMessage: operation.errors.length > 0 ? operation.errors[ 0 ].message : undefined
            };

            this.auditLog.push( auditEntry );

            // Keep only last 1000 audit entries to prevent memory issues
            if ( this.auditLog.length > 1000 ) {
                this.auditLog = this.auditLog.slice( -1000 );
            }

        } catch ( error ) {
            console.error( `Failed to log operation ${operation.operationId}: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Generate detailed assignment report
     * Implements Requirements 5.1, 5.3: Generate summaries and provide detailed reporting
     */
    async generateDetailedReport(): Promise<string> {
        try {
            const summary = await this.generateAssignmentSummary();
            const permissionSets = await this.awsClient.listPermissionSets();
            const accounts = await this.awsClient.listOrganizationAccounts();

            let report = '# AWS-Azure SSO Assignment Report\n\n';
            report += `Generated: ${new Date().toISOString()}\n\n`;

            // Summary section
            report += '## Summary\n\n';
            report += `- Total Assignments: ${summary.totalAssignments}\n`;
            report += `- Active Assignments: ${summary.activeAssignments}\n`;
            report += `- Failed Assignments: ${summary.failedAssignments}\n`;
            report += `- Pending Assignments: ${summary.pendingAssignments}\n\n`;

            // Assignments by account
            report += '## Assignments by Account\n\n';
            for ( const [ accountId, count ] of Object.entries( summary.assignmentsByAccount ) ) {
                const account = accounts.find( a => a.accountId === accountId );
                const accountName = account?.accountName || 'Unknown';
                report += `- ${accountName} (${accountId}): ${count} assignments\n`;
            }
            report += '\n';

            // Assignments by permission set
            report += '## Assignments by Permission Set\n\n';
            for ( const [ psName, count ] of Object.entries( summary.assignmentsByPermissionSet ) ) {
                report += `- ${psName}: ${count} assignments\n`;
            }
            report += '\n';

            // Permission sets details
            report += '## Permission Sets\n\n';
            for ( const ps of permissionSets ) {
                report += `### ${ps.name}\n`;
                report += `- ARN: ${ps.arn}\n`;
                report += `- Description: ${ps.description || 'No description'}\n`;
                report += `- Session Duration: ${ps.sessionDuration}\n`;
                report += `- Managed Policies: ${ps.managedPolicies.length}\n`;
                report += `- Has Inline Policy: ${ps.inlinePolicy ? 'Yes' : 'No'}\n`;
                report += `- Account Assignments: ${ps.accountAssignments.length}\n\n`;
            }

            // Recent operations
            report += '## Recent Operations\n\n';
            for ( const operation of summary.recentOperations ) {
                report += `### Operation ${operation.operationId}\n`;
                report += `- Type: ${operation.operationType}\n`;
                report += `- Status: ${operation.status}\n`;
                report += `- Start Time: ${operation.startTime.toISOString()}\n`;
                report += `- End Time: ${operation.endTime?.toISOString() || 'In Progress'}\n`;
                report += `- Assignments: ${operation.assignments.length}\n`;
                if ( operation.errors.length > 0 ) {
                    report += `- Errors: ${operation.errors.length}\n`;
                }
                report += '\n';
            }

            return report;
        } catch ( error ) {
            throw new Error( `Failed to generate detailed report: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Export audit log
     * Implements Requirements 5.2: Maintain operation history and audit logs
     */
    async exportAuditLog(): Promise<AuditLogEntry[]> {
        return [ ...this.auditLog ]; // Return a copy to prevent modification
    }

    /**
     * Generate compliance report
     * Implements Requirements 8.3: Ensure all group additions are properly logged and auditable
     */
    async generateComplianceReport( startDate?: Date, endDate?: Date ): Promise<string> {
        try {
            const filteredLog = this.auditLog.filter( entry => {
                if ( startDate && entry.timestamp < startDate ) return false;
                if ( endDate && entry.timestamp > endDate ) return false;
                return true;
            } );

            let report = '# Compliance Report\n\n';
            report += `Report Period: ${startDate?.toISOString() || 'All time'} to ${endDate?.toISOString() || 'Present'}\n`;
            report += `Generated: ${new Date().toISOString()}\n\n`;

            // Summary statistics
            const totalOperations = filteredLog.length;
            const successfulOperations = filteredLog.filter( e => e.result === 'SUCCESS' ).length;
            const failedOperations = filteredLog.filter( e => e.result === 'FAILURE' ).length;
            const partialOperations = filteredLog.filter( e => e.result === 'PARTIAL' ).length;

            report += '## Summary\n\n';
            report += `- Total Operations: ${totalOperations}\n`;
            report += `- Successful Operations: ${successfulOperations}\n`;
            report += `- Failed Operations: ${failedOperations}\n`;
            report += `- Partial Operations: ${partialOperations}\n`;
            report += `- Success Rate: ${totalOperations > 0 ? ( ( successfulOperations / totalOperations ) * 100 ).toFixed( 2 ) : 0}%\n\n`;

            // Operations by type
            const operationsByType = new Map<string, number>();
            for ( const entry of filteredLog ) {
                operationsByType.set( entry.operationType, ( operationsByType.get( entry.operationType ) || 0 ) + 1 );
            }

            report += '## Operations by Type\n\n';
            for ( const [ type, count ] of operationsByType.entries() ) {
                report += `- ${type}: ${count}\n`;
            }
            report += '\n';

            // Detailed log entries
            report += '## Detailed Log\n\n';
            for ( const entry of filteredLog.slice( -50 ) ) { // Last 50 entries
                report += `### ${entry.timestamp.toISOString()}\n`;
                report += `- Operation ID: ${entry.operationId}\n`;
                report += `- Type: ${entry.operationType}\n`;
                report += `- Result: ${entry.result}\n`;
                if ( entry.userId ) {
                    report += `- User: ${entry.userId}\n`;
                }
                if ( entry.errorMessage ) {
                    report += `- Error: ${entry.errorMessage}\n`;
                }
                report += '\n';
            }

            return report;
        } catch ( error ) {
            throw new Error( `Failed to generate compliance report: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Save report to file
     */
    async saveReportToFile( report: string, filename: string, directory: string = './reports' ): Promise<string> {
        try {
            // Ensure directory exists
            await fs.mkdir( directory, { recursive: true } );

            // Generate full path
            const timestamp = new Date().toISOString().replace( /[:.]/g, '-' );
            const fullFilename = `${filename}-${timestamp}.md`;
            const fullPath = path.join( directory, fullFilename );

            // Write file
            await fs.writeFile( fullPath, report, 'utf8' );

            return fullPath;
        } catch ( error ) {
            throw new Error( `Failed to save report to file: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Save configuration export to file
     */
    async saveConfigurationToFile( config: ConfigurationExport, directory: string = './backups' ): Promise<string> {
        try {
            // Ensure directory exists
            await fs.mkdir( directory, { recursive: true } );

            // Generate filename with timestamp
            const timestamp = new Date().toISOString().replace( /[:.]/g, '-' );
            const filename = `aws-azure-sso-config-${timestamp}.json`;
            const fullPath = path.join( directory, filename );

            // Write file
            await fs.writeFile( fullPath, JSON.stringify( config, null, 2 ), 'utf8' );

            return fullPath;
        } catch ( error ) {
            throw new Error( `Failed to save configuration to file: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Load configuration from file
     */
    async loadConfigurationFromFile( filePath: string ): Promise<ConfigurationExport> {
        try {
            const content = await fs.readFile( filePath, 'utf8' );
            return JSON.parse( content ) as ConfigurationExport;
        } catch ( error ) {
            throw new Error( `Failed to load configuration from file: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Get operation statistics
     */
    getOperationStatistics(): {
        totalOperations: number;
        operationsByType: Record<string, number>;
        operationsByStatus: Record<string, number>;
        averageOperationDuration: number;
        recentFailures: AssignmentOperation[];
    } {
        const operations = Array.from( this.operationHistory.values() );

        const operationsByType: Record<string, number> = {};
        const operationsByStatus: Record<string, number> = {};
        let totalDuration = 0;
        let completedOperations = 0;

        for ( const operation of operations ) {
            // Count by type
            operationsByType[ operation.operationType ] = ( operationsByType[ operation.operationType ] || 0 ) + 1;

            // Count by status
            operationsByStatus[ operation.status ] = ( operationsByStatus[ operation.status ] || 0 ) + 1;

            // Calculate duration for completed operations
            if ( operation.endTime ) {
                totalDuration += operation.endTime.getTime() - operation.startTime.getTime();
                completedOperations++;
            }
        }

        const averageOperationDuration = completedOperations > 0 ? totalDuration / completedOperations : 0;

        // Get recent failures (last 24 hours)
        const oneDayAgo = new Date( Date.now() - 24 * 60 * 60 * 1000 );
        const recentFailures = operations.filter( op =>
            op.status === 'FAILED' && op.startTime > oneDayAgo
        );

        return {
            totalOperations: operations.length,
            operationsByType,
            operationsByStatus,
            averageOperationDuration,
            recentFailures
        };
    }

    /**
     * Clear old audit logs and operations
     */
    clearOldData( olderThanDays: number = 30 ): void {
        const cutoffDate = new Date( Date.now() - olderThanDays * 24 * 60 * 60 * 1000 );

        // Clear old audit logs
        this.auditLog = this.auditLog.filter( entry => entry.timestamp > cutoffDate );

        // Clear old operations
        for ( const [ operationId, operation ] of this.operationHistory.entries() ) {
            if ( operation.startTime < cutoffDate ) {
                this.operationHistory.delete( operationId );
            }
        }
    }
}
