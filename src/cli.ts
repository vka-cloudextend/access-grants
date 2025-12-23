#!/usr/bin/env node

import { Command } from 'commander';
import { config } from 'dotenv';

// Load environment variables
config();

const program = new Command();

program
    .name( 'aws-ag' )
    .description( 'AWS Access Grants - CLI tool for managing Azure AD security groups within AWS IAM Identity Center integration' )
    .version( '1.0.0' );

// Placeholder for commands - will be implemented in later tasks
program
    .command( 'discover-groups' )
    .description( 'List and filter Azure AD groups' )
    .action( () => {
        console.log( 'discover-groups command - to be implemented' );
    } );

program
    .command( 'list-permission-sets' )
    .description( 'Show available AWS permission sets' )
    .action( () => {
        console.log( 'list-permission-sets command - to be implemented' );
    } );

program
    .command( 'assign-group' )
    .description( 'Assign a group to permission set and accounts' )
    .action( () => {
        console.log( 'assign-group command - to be implemented' );
    } );

program
    .command( 'bulk-assign' )
    .description( 'Assign multiple groups at once' )
    .action( () => {
        console.log( 'bulk-assign command - to be implemented' );
    } );

program
    .command( 'list-assignments' )
    .description( 'Show current group assignments' )
    .action( () => {
        console.log( 'list-assignments command - to be implemented' );
    } );

program
    .command( 'validate-assignments' )
    .description( 'Test assignment functionality' )
    .action( () => {
        console.log( 'validate-assignments command - to be implemented' );
    } );

program
    .command( 'export-config' )
    .description( 'Export current configuration' )
    .action( () => {
        console.log( 'export-config command - to be implemented' );
    } );

program
    .command( 'rollback' )
    .description( 'Undo recent assignments' )
    .action( () => {
        console.log( 'rollback command - to be implemented' );
    } );

// Parse command line arguments
program.parse();

export { program };
