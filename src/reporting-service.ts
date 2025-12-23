// Reporting Service - High-level reporting and audit orchestration
import { AWSClient } from './clients/aws-client';
import { AzureClient } from './clients/azure-client';
import { AssignmentOperation, GroupAssignment } from './types';
import { ConfigurationReporter, AssignmentSummary, AuditLogEntry, ConfigurationExport } from './reporter';

export interface ReportingServiceConfig {
    azure: {
        tenantId: string;
        clientId: string;
        clientSecret: string;
    };
    aws: {
        region: string;
        identityCenterInstanceArn: string;
        identityStoreId: string;
    };
    reporting: {
        outputDirectory?: string;
        retentionDays?: number;
        enableAuditLog?: boolean;
    };
}

export interface AssignmentReport {
    summary: AssignmentSummary;
    detailedReport: string;
    complianceReport: string;
    exportPath?: string;
}

export interface AuditReport {
    entries: AuditLogEntry[];
    summary: {
        totalEntries: number;
        successRate: number;
        failureRate: number;
        operationsByType: Record<string, number>;
        timeRange: {
            start: Date;
            end: Date;
        };
    };
    complianceReport: string;
}

export class ReportingService {
    private azureClient: AzureClient;
    private awsClient: AWSClient;
    private reporter: ConfigurationReporter;
    private config: ReportingServiceConfig;

    constructor( config: ReportingServiceConfig ) {
        this.config = config;
        this.azureClient = new AzureClient( config.azure );
        this.awsClient = new AWSClient( config.aws );
        this.reporter = new ConfigurationReporter( this.azureClient, this.awsClient );
    }

    /**
     * Generate assignment summaries and reports
     * Implements Requirements 5.1: Display current group-to-permission mappings across all AWS accounts
     */
    async generateAssignmentSummariesAndReports(): Promise<AssignmentReport> {
        try {
            // Generate summary
            const summary = await this.reporter.generateAssignmentSummary();

            // Generate detailed report
            const detailedReport = await this.reporter.generateDetailedReport();

            // Generate compliance report
            const complianceReport = await this.reporter.generateComplianceReport();

            // Save reports to files if output directory is configured
            let exportPath: string | undefined;
            if ( this.config.reporting.outputDirectory ) {
                exportPath = await this.reporter.saveReportToFile(
                    detailedReport,
                    'assignment-report',
                    this.config.reporting.outputDirectory
                );

                // Also save compliance report
                await this.reporter.saveReportToFile(
                    complianceReport,
                    'compliance-report',
                    this.config.reporting.outputDirectory
                );
            }

            return {
                summary,
                detailedReport,
                complianceReport,
                exportPath
            };
        } catch ( error ) {
            throw new Error( `Failed to generate assignment reports: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Maintain operation history and audit logs
     * Implements Requirements 5.2: Maintain a history of group additions and modifications
     */
    async maintainOperationHistoryAndAuditLogs( operation: AssignmentOperation ): Promise<void> {
        try {
            // Log the operation
            await this.reporter.logOperation( operation );

            // Clean up old data if retention policy is configured
            if ( this.config.reporting.retentionDays ) {
                this.reporter.clearOldData( this.config.reporting.retentionDays );
            }
        } catch ( error ) {
            // eslint-disable-next-line no-console
            console.error( `Failed to maintain operation history: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Export configuration for backup/replication
     * Implements Requirements 5.4: Create configuration files that can be used for backup or replication
     */
    async exportConfigurationForBackupReplication(): Promise<{
        config: ConfigurationExport;
        exportPath?: string;
    }> {
        try {
            // Generate configuration export
            const config = await this.reporter.exportConfiguration();

            // Save to file if output directory is configured
            let exportPath: string | undefined;
            if ( this.config.reporting.outputDirectory ) {
                exportPath = await this.reporter.saveConfigurationToFile(
                    config,
                    this.config.reporting.outputDirectory
                );
            }

            return {
                config,
                exportPath
            };
        } catch ( error ) {
            throw new Error( `Failed to export configuration: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Generate comprehensive audit report
     * Implements Requirements 8.3: Ensure that all group additions are properly logged and auditable
     */
    async generateAuditReport( startDate?: Date, endDate?: Date ): Promise<AuditReport> {
        try {
            // Get audit log entries
            const allEntries = await this.reporter.exportAuditLog();

            // Filter by date range if provided
            const entries = allEntries.filter( entry => {
                if ( startDate && entry.timestamp < startDate ) return false;
                if ( endDate && entry.timestamp > endDate ) return false;
                return true;
            } );

            // Calculate summary statistics
            const totalEntries = entries.length;
            const successfulEntries = entries.filter( e => e.result === 'SUCCESS' ).length;
            const failedEntries = entries.filter( e => e.result === 'FAILURE' ).length;

            const successRate = totalEntries > 0 ? ( successfulEntries / totalEntries ) * 100 : 0;
            const failureRate = totalEntries > 0 ? ( failedEntries / totalEntries ) * 100 : 0;

            // Group by operation type
            const operationsByType: Record<string, number> = {};
            for ( const entry of entries ) {
                operationsByType[ entry.operationType ] = ( operationsByType[ entry.operationType ] || 0 ) + 1;
            }

            // Determine time range
            const timeRange = {
                start: entries.length > 0 ? new Date( Math.min( ...entries.map( e => e.timestamp.getTime() ) ) ) : new Date(),
                end: entries.length > 0 ? new Date( Math.max( ...entries.map( e => e.timestamp.getTime() ) ) ) : new Date()
            };

            // Generate compliance report
            const complianceReport = await this.reporter.generateComplianceReport( startDate, endDate );

            return {
                entries,
                summary: {
                    totalEntries,
                    successRate,
                    failureRate,
                    operationsByType,
                    timeRange
                },
                complianceReport
            };
        } catch ( error ) {
            throw new Error( `Failed to generate audit report: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Generate assignment change history report
     */
    async generateAssignmentChangeHistory(): Promise<{
        changes: Array<{
            timestamp: Date;
            operationType: string;
            assignment: GroupAssignment;
            status: string;
            errors?: string[];
        }>;
        summary: {
            totalChanges: number;
            successfulChanges: number;
            failedChanges: number;
            changesByType: Record<string, number>;
        };
    }> {
        try {
            const auditEntries = await this.reporter.exportAuditLog();

            const changes: Array<{
                timestamp: Date;
                operationType: string;
                assignment: GroupAssignment;
                status: string;
                errors?: string[];
            }> = [];

            let successfulChanges = 0;
            let failedChanges = 0;
            const changesByType: Record<string, number> = {};

            for ( const entry of auditEntries ) {
                if ( entry.details.assignments && Array.isArray( entry.details.assignments ) ) {
                    for ( const assignment of entry.details.assignments as GroupAssignment[] ) {
                        changes.push( {
                            timestamp: entry.timestamp,
                            operationType: entry.operationType,
                            assignment,
                            status: entry.result,
                            errors: entry.errorMessage ? [ entry.errorMessage ] : undefined
                        } );

                        // Update counters
                        if ( entry.result === 'SUCCESS' ) {
                            successfulChanges++;
                        } else {
                            failedChanges++;
                        }

                        changesByType[ entry.operationType ] = ( changesByType[ entry.operationType ] || 0 ) + 1;
                    }
                }
            }

            // Sort by timestamp (most recent first)
            changes.sort( ( a, b ) => b.timestamp.getTime() - a.timestamp.getTime() );

            return {
                changes,
                summary: {
                    totalChanges: changes.length,
                    successfulChanges,
                    failedChanges,
                    changesByType
                }
            };
        } catch ( error ) {
            throw new Error( `Failed to generate assignment change history: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }

    /**
     * Generate system health report
     */
    async generateSystemHealthReport(): Promise<{
        azureHealth: {
            connected: boolean;
            groupCount: number;
            errors: string[];
        };
        awsHealth: {
            connected: boolean;
            permissionSetCount: number;
            accountCount: number;
            assignmentCount: number;
            errors: string[];
        };
        synchronizationHealth: {
            syncedGroups: number;
            unsyncedGroups: number;
            syncErrors: string[];
        };
        overallHealth: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    }> {
        const report = {
            azureHealth: {
                connected: false,
                groupCount: 0,
                errors: [] as string[]
            },
            awsHealth: {
                connected: false,
                permissionSetCount: 0,
                accountCount: 0,
                assignmentCount: 0,
                errors: [] as string[]
            },
            synchronizationHealth: {
                syncedGroups: 0,
                unsyncedGroups: 0,
                syncErrors: [] as string[]
            },
            overallHealth: 'CRITICAL' as 'HEALTHY' | 'WARNING' | 'CRITICAL'
        };

        // Test Azure connectivity
        try {
            const azureGroups = await this.azureClient.listSecurityGroups();
            report.azureHealth.connected = true;
            report.azureHealth.groupCount = azureGroups.length;
        } catch ( error ) {
            report.azureHealth.errors.push( error instanceof Error ? error.message : 'Unknown Azure error' );
        }

        // Test AWS connectivity
        try {
            const [ permissionSets, accounts, assignments ] = await Promise.all( [
                this.awsClient.listPermissionSets(),
                this.awsClient.listOrganizationAccounts(),
                this.awsClient.listAccountAssignments()
            ] );

            report.awsHealth.connected = true;
            report.awsHealth.permissionSetCount = permissionSets.length;
            report.awsHealth.accountCount = accounts.length;
            report.awsHealth.assignmentCount = assignments.length;
        } catch ( error ) {
            report.awsHealth.errors.push( error instanceof Error ? error.message : 'Unknown AWS error' );
        }

        // Test synchronization health (if both services are connected)
        if ( report.azureHealth.connected && report.awsHealth.connected ) {
            try {
                const azureGroups = await this.azureClient.listSecurityGroups();

                for ( const group of azureGroups.slice( 0, 10 ) ) { // Test first 10 groups
                    try {
                        const syncStatus = await this.awsClient.checkGroupSynchronizationStatus( group.id );
                        if ( syncStatus.isSynced ) {
                            report.synchronizationHealth.syncedGroups++;
                        } else {
                            report.synchronizationHealth.unsyncedGroups++;
                        }
                    } catch ( error ) {
                        report.synchronizationHealth.syncErrors.push(
                            `Group ${group.displayName}: ${error instanceof Error ? error.message : 'Unknown error'}`
                        );
                    }
                }
            } catch ( error ) {
                report.synchronizationHealth.syncErrors.push( error instanceof Error ? error.message : 'Unknown sync error' );
            }
        }

        // Determine overall health
        const hasAzureErrors = report.azureHealth.errors.length > 0;
        const hasAWSErrors = report.awsHealth.errors.length > 0;
        const hasSyncErrors = report.synchronizationHealth.syncErrors.length > 0;

        if ( !hasAzureErrors && !hasAWSErrors && !hasSyncErrors ) {
            report.overallHealth = 'HEALTHY';
        } else if ( report.azureHealth.connected && report.awsHealth.connected ) {
            report.overallHealth = 'WARNING';
        } else {
            report.overallHealth = 'CRITICAL';
        }

        return report;
    }

    /**
     * Get operation statistics
     */
    getOperationStatistics() {
        return this.reporter.getOperationStatistics();
    }

    /**
     * Schedule periodic reporting
     */
    schedulePeriodicReporting( intervalHours: number = 24 ): ReturnType<typeof setInterval> {
        return setInterval( async () => {
            try {
                // eslint-disable-next-line no-console
                console.log( 'Running scheduled reporting...' );

                // Generate reports
                const assignmentReport = await this.generateAssignmentSummariesAndReports();
                const auditReport = await this.generateAuditReport();
                const healthReport = await this.generateSystemHealthReport();

                // eslint-disable-next-line no-console
                console.log( `Scheduled reporting completed:
                - Assignment Report: ${assignmentReport.exportPath || 'Generated'}
                - Audit Entries: ${auditReport.entries.length}
                - System Health: ${healthReport.overallHealth}` );

                // Clean up old data
                if ( this.config.reporting.retentionDays ) {
                    this.reporter.clearOldData( this.config.reporting.retentionDays );
                }

            } catch ( error ) {
                // eslint-disable-next-line no-console
                console.error( `Scheduled reporting failed: ${error instanceof Error ? error.message : 'Unknown error'}` );
            }
        }, intervalHours * 60 * 60 * 1000 );
    }

    /**
     * Export all reports as a bundle
     */
    async exportReportBundle(): Promise<{
        assignmentReport: AssignmentReport;
        auditReport: AuditReport;
        healthReport: {
            azureHealth: {
                connected: boolean;
                groupCount: number;
                errors: string[];
            };
            awsHealth: {
                connected: boolean;
                permissionSetCount: number;
                accountCount: number;
                assignmentCount: number;
                errors: string[];
            };
            synchronizationHealth: {
                syncedGroups: number;
                unsyncedGroups: number;
                syncErrors: string[];
            };
            overallHealth: 'HEALTHY' | 'WARNING' | 'CRITICAL';
        };
        configExport: ConfigurationExport;
        bundlePath?: string;
    }> {
        try {
            const [ assignmentReport, auditReport, healthReport, configResult ] = await Promise.all( [
                this.generateAssignmentSummariesAndReports(),
                this.generateAuditReport(),
                this.generateSystemHealthReport(),
                this.exportConfigurationForBackupReplication()
            ] );

            // Create bundle report
            const bundleReport = {
                generatedAt: new Date().toISOString(),
                assignmentSummary: assignmentReport.summary,
                auditSummary: auditReport.summary,
                systemHealth: healthReport,
                configurationMetadata: configResult.config.metadata
            };

            // Save bundle if output directory is configured
            let bundlePath: string | undefined;
            if ( this.config.reporting.outputDirectory ) {
                bundlePath = await this.reporter.saveReportToFile(
                    JSON.stringify( bundleReport, null, 2 ),
                    'report-bundle',
                    this.config.reporting.outputDirectory
                );
            }

            return {
                assignmentReport,
                auditReport,
                healthReport,
                configExport: configResult.config,
                bundlePath
            };
        } catch ( error ) {
            throw new Error( `Failed to export report bundle: ${error instanceof Error ? error.message : 'Unknown error'}` );
        }
    }
}
