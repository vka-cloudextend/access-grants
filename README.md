# AWS Access Grants (aws-ag)

A TypeScript CLI tool for managing Azure AD security groups within an existing AWS IAM Identity Center integration.

## Features

- Discover and validate Azure AD security groups
- Create and manage AWS permission sets
- Assign groups to AWS accounts and permission sets
- Bulk operations support
- Assignment validation and testing
- Configuration export/import
- Rollback capabilities

## Prerequisites

- Node.js 18.0.0 or higher
- Existing AWS IAM Identity Center integration with Azure AD
- Azure AD application with appropriate permissions
- AWS credentials with SSO Admin permissions

## Installation

```bash
npm install
npm run build
```

## Configuration

1. Copy `.env.example` to `.env`
2. Fill in your Azure AD and AWS configuration values

```bash
cp .env.example .env
```

## Usage

```bash
# Build the project
npm run build

# Run the CLI
npm start -- <command>

# Or use the binary directly
./dist/cli.js <command>

# Or if installed globally
aws-ag <command>
```

### Available Commands

- `discover-groups` - List and filter Azure AD groups
- `list-permission-sets` - Show available AWS permission sets
- `assign-group` - Assign a group to permission set and accounts
- `bulk-assign` - Assign multiple groups at once
- `list-assignments` - Show current group assignments
- `validate-assignments` - Test assignment functionality
- `export-config` - Export current configuration
- `rollback` - Undo recent assignments

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Lint code
npm run lint

# Fix linting issues
npm run lint:fix
```

### Commit Guidelines

This project follows [Conventional Commits](https://www.conventionalcommits.org/) specification. See `.kiro/steering/conventional-commits.md` for detailed guidelines.

Quick format: `<type>[scope]: <description>`

Examples:
- `feat(cli): add discover-groups command`
- `fix(azure): handle authentication timeout`
- `docs: update installation instructions`

## Project Structure

```
src/
├── cli.ts              # CLI interface and commands
├── types/              # TypeScript type definitions
├── clients/            # Azure AD and AWS API clients
├── orchestrator/       # Assignment orchestration logic
├── validator/          # Assignment validation
├── reporter/           # Configuration reporting
└── test/               # Test utilities and setup
```

## License

MIT
