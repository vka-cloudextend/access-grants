---
inclusion: manual
---

# Conventional Commits Style Guide

This project follows the Conventional Commits specification for commit messages. This provides a consistent format that enables automated tooling and clear communication about changes.

## Commit Message Format

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

## Types

Use these standard types for commits:

### Primary Types
- **feat**: A new feature for the user
- **fix**: A bug fix for the user
- **docs**: Documentation only changes
- **style**: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- **refactor**: A code change that neither fixes a bug nor adds a feature
- **test**: Adding missing tests or correcting existing tests
- **chore**: Changes to the build process or auxiliary tools and libraries

### Additional Types
- **perf**: A code change that improves performance
- **ci**: Changes to CI configuration files and scripts
- **build**: Changes that affect the build system or external dependencies
- **revert**: Reverts a previous commit

## Scopes

Use these scopes to indicate the area of change:

- **cli**: Command-line interface changes
- **azure**: Azure AD client and integration
- **aws**: AWS IAM Identity Center client and integration
- **orchestrator**: Assignment orchestration logic
- **validator**: Assignment validation functionality
- **reporter**: Configuration reporting and audit
- **types**: TypeScript type definitions
- **config**: Configuration files and setup
- **deps**: Dependency updates

## Examples

### Good Commit Messages

```bash
# New feature
feat(cli): add discover-groups command with filtering options

# Bug fix
fix(azure): handle authentication timeout errors gracefully

# Documentation
docs: update README with installation instructions

# Refactoring
refactor(orchestrator): extract assignment validation logic

# Testing
test(validator): add property-based tests for assignment validation

# Configuration changes
chore(config): update TypeScript compiler options

# Breaking change
feat(cli)!: change command structure for better UX

BREAKING CHANGE: The command structure has changed from 'aws-ag command' to 'aws-ag <action> <resource>'
```

### Bad Commit Messages

```bash
# Too vague
fix: stuff

# Not descriptive
update files

# Wrong type
feat: fix typo in README

# Missing type
add new validation logic
```

## Guidelines

1. **Use lowercase** for type, scope, and description
2. **No period** at the end of the description
3. **Imperative mood** in the description (e.g., "add" not "added" or "adds")
4. **Limit description to 50 characters** when possible
5. **Use body** to explain what and why, not how
6. **Use footer** for breaking changes and issue references

## Breaking Changes

Mark breaking changes with `!` after the type/scope:

```bash
feat(cli)!: redesign command interface
```

Or use the footer:

```bash
feat(cli): redesign command interface

BREAKING CHANGE: Command arguments have changed. See migration guide.
```

## Issue References

Reference issues in the footer:

```bash
fix(azure): resolve group sync timeout

Fixes #123
Closes #456
```

## Multi-line Example

```bash
feat(orchestrator): implement bulk assignment with rollback

Add support for assigning multiple Azure AD groups to AWS accounts
in a single operation. Includes automatic rollback on partial failures
and detailed progress reporting.

- Add BulkAssignmentOperation class
- Implement transaction-like rollback mechanism
- Add progress tracking with detailed error reporting
- Update CLI to support bulk operations

Closes #45
```

## Automation Benefits

Following this format enables:
- **Automatic changelog generation**
- **Semantic version bumping**
- **Release note generation**
- **Better git history navigation**
- **Automated deployment triggers**

## Tools Integration

Consider adding these tools to enforce conventional commits:

```bash
# Install commitizen for interactive commits
npm install -g commitizen cz-conventional-changelog

# Use commitizen
git cz
```

## Quick Reference

| Type | Description | Example |
|------|-------------|---------|
| `feat` | New feature | `feat(cli): add group discovery` |
| `fix` | Bug fix | `fix(azure): handle auth errors` |
| `docs` | Documentation | `docs: update API examples` |
| `style` | Code style | `style: fix linting issues` |
| `refactor` | Code refactoring | `refactor: extract validation logic` |
| `test` | Tests | `test: add integration tests` |
| `chore` | Maintenance | `chore: update dependencies` |
