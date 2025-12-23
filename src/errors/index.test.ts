// Tests for Error Handling
import {
    AWSAGError,
    ConfigurationError,
    AzureError,
    AWSError,
    ValidationError,
    ValidationUtils,
    RetryManager,
    ErrorHandler
} from './index';

describe( 'Error Handling', () => {
    describe( 'AWSAGError', () => {
        test( 'should create error with proper properties', () => {
            const error = new ConfigurationError( 'Test message', { key: 'value' } );

            expect( error.code ).toBe( 'CONFIG_ERROR' );
            expect( error.message ).toBe( 'Test message' );
            expect( error.retryable ).toBe( false );
            expect( error.context ).toEqual( { key: 'value' } );
            expect( error.timestamp ).toBeInstanceOf( Date );
        } );

        test( 'should provide display message', () => {
            const error = new ConfigurationError( 'Test message' );

            expect( error.getDisplayMessage() ).toContain( '[CONFIG_ERROR]' );
            expect( error.getDisplayMessage() ).toContain( 'Configuration error' );
        } );
    } );

    describe( 'ValidationUtils', () => {
        test( 'should validate email format', () => {
            expect( () => ValidationUtils.validateEmail( 'valid@example.com' ) ).not.toThrow();
            expect( () => ValidationUtils.validateEmail( 'invalid-email' ) ).toThrow( ValidationError );
        } );

        test( 'should validate AWS account ID format', () => {
            expect( () => ValidationUtils.validateAWSAccountId( '123456789012' ) ).not.toThrow();
            expect( () => ValidationUtils.validateAWSAccountId( '12345' ) ).toThrow( ValidationError );
            expect( () => ValidationUtils.validateAWSAccountId( 'abc123456789' ) ).toThrow( ValidationError );
        } );

        test( 'should validate ticket ID format', () => {
            expect( () => ValidationUtils.validateTicketId( 'AG-123' ) ).not.toThrow();
            expect( () => ValidationUtils.validateTicketId( 'AG-1234' ) ).not.toThrow();
            expect( () => ValidationUtils.validateTicketId( 'AG-12' ) ).toThrow( ValidationError );
            expect( () => ValidationUtils.validateTicketId( 'INVALID-123' ) ).toThrow( ValidationError );
        } );

        test( 'should validate account type', () => {
            expect( () => ValidationUtils.validateAccountType( 'Dev' ) ).not.toThrow();
            expect( () => ValidationUtils.validateAccountType( 'QA' ) ).not.toThrow();
            expect( () => ValidationUtils.validateAccountType( 'Staging' ) ).not.toThrow();
            expect( () => ValidationUtils.validateAccountType( 'Prod' ) ).not.toThrow();
            expect( () => ValidationUtils.validateAccountType( 'Invalid' ) ).toThrow( ValidationError );
        } );

        test( 'should validate group name format', () => {
            expect( () => ValidationUtils.validateGroupName( 'CE-AWS-Dev-AG-123' ) ).not.toThrow();
            expect( () => ValidationUtils.validateGroupName( 'CE-AWS-Prod-AG-1234' ) ).not.toThrow();
            expect( () => ValidationUtils.validateGroupName( 'INVALID-FORMAT' ) ).toThrow( ValidationError );
        } );
    } );

    describe( 'RetryManager', () => {
        test( 'should execute operation successfully on first try', async () => {
            const retryManager = new RetryManager( { maxAttempts: 3 } );
            const operation = jest.fn().mockResolvedValue( 'success' );

            const result = await retryManager.execute( operation );

            expect( result ).toBe( 'success' );
            expect( operation ).toHaveBeenCalledTimes( 1 );
        } );
    } );
} );
