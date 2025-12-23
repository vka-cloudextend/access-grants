// Jest test setup
import { config } from 'dotenv';

// Load test environment variables
config( { path: '.env.test' } );

// Global test setup
beforeAll( () => {
    // Setup code that runs before all tests
} );

afterAll( () => {
    // Cleanup code that runs after all tests
} );

// Mock console methods to reduce noise in tests
global.console = {
    ...console,
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
};
