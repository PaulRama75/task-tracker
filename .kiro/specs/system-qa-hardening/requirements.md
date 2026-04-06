# Requirements Document

## Introduction

This document defines the requirements for hardening the Task Tracker application based on a QA review that identified 16 issues across critical security vulnerabilities, security hardening, code quality, frontend accessibility, and operational gaps. The requirements are derived from the approved design document and ensure each issue is addressed with testable, EARS-compliant acceptance criteria.

## Glossary

- **Server**: The Node.js Express backend application (server.js and route modules)
- **Session_Store**: The PostgreSQL-backed session persistence layer replacing in-memory sessions
- **Brute_Force_Store**: The PostgreSQL-backed login attempt tracking system replacing in-memory loginAttempts
- **Auth_Middleware**: The middleware responsible for authenticating requests via Bearer tokens
- **Upload_Validator**: The middleware responsible for validating file uploads by size, MIME type, and extension
- **Security_Middleware**: The middleware layer providing CSP, CORS, and HSTS headers via helmet and cors
- **Error_Handler**: The global async error handler and asyncHandler wrapper for route functions
- **Audit_Logger**: The component that records security-relevant actions to the audit_log database table
- **Pagination_Helper**: The utility that parses page/limit query parameters and computes SQL offset
- **Config_Loader**: The centralized configuration module that reads environment variables
- **Migration_Runner**: The script responsible for migrating JSON data to PostgreSQL with rollback support
- **Route_Module**: An Express Router file containing a focused subset of API endpoints

## Requirements

### Requirement 1: Remove Hardcoded Filesystem Paths

**User Story:** As a developer, I want all filesystem paths to come from environment variables, so that the application is portable across environments and does not leak private directory structures.

#### Acceptance Criteria

1. THE Config_Loader SHALL read the tracker directory path from the `TRACKER_DIR` environment variable
2. WHEN `TRACKER_DIR` is not set, THE Server SHALL skip auto-import functionality without error
3. THE Server SHALL contain no hardcoded absolute filesystem paths in source code
4. WHEN the application starts in production, THE Config_Loader SHALL throw an error if required database environment variables (`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`) are missing

### Requirement 2: Persistent Session Storage

**User Story:** As a system administrator, I want sessions to persist across server restarts, so that users are not forced to re-authenticate after deployments or crashes.

#### Acceptance Criteria

1. WHEN a user logs in, THE Session_Store SHALL persist the session token, username, role, and expiration to the PostgreSQL `sessions` table
2. WHEN a valid session token is presented, THE Auth_Middleware SHALL retrieve the session from the Session_Store and populate `req.user`
3. WHEN a session token is used, THE Session_Store SHALL update the `last_activity` timestamp
4. WHEN a session has been inactive longer than the configured timeout, THE Auth_Middleware SHALL reject the token and return a 401 response
5. THE Session_Store SHALL run a periodic cleanup job that deletes expired sessions from the database
6. WHEN a user logs out, THE Session_Store SHALL delete the session record from the database

### Requirement 3: Enforce bcrypt-Only Password Hashing

**User Story:** As a security engineer, I want password hashing to use bcrypt exclusively, so that weak SHA256 fallback cannot be exploited.

#### Acceptance Criteria

1. THE Server SHALL use bcrypt with a cost factor of 12 for all password hashing operations
2. WHEN bcrypt is unavailable at startup, THE Server SHALL refuse to start and log a clear error message
3. THE Server SHALL not contain any SHA256 password hashing fallback code
4. WHEN verifying a password, THE Auth_Middleware SHALL use only `bcrypt.compare` for comparison

### Requirement 4: File Upload Validation

**User Story:** As a security engineer, I want uploaded files to be validated for size, type, and extension, so that malicious or oversized files are rejected before processing.

#### Acceptance Criteria

1. WHEN a file upload exceeds 10MB, THE Upload_Validator SHALL reject the request with a 413 status code
2. WHEN a file has a MIME type not in the allowed list (xlsx, xls, csv), THE Upload_Validator SHALL reject the request with a 400 status code
3. WHEN a file extension does not match `.xlsx`, `.xls`, or `.csv`, THE Upload_Validator SHALL reject the request with a 400 status code
4. WHEN a file passes all validation checks, THE Upload_Validator SHALL allow the request to proceed to the route handler
5. IF an upload error occurs during processing, THEN THE Server SHALL delete the temporary file from disk

### Requirement 5: Security Headers (CSP, CORS, HSTS)

**User Story:** As a security engineer, I want proper security headers on all HTTP responses, so that the application is protected against XSS, clickjacking, and MIME-sniffing attacks.

#### Acceptance Criteria

1. THE Security_Middleware SHALL set a Content Security Policy header restricting `default-src` to `'self'`
2. THE Security_Middleware SHALL set `script-src` to allow only `'self'` and `https://cdn.jsdelivr.net`
3. THE Security_Middleware SHALL set `object-src` to `'none'` and `frame-ancestors` to `'self'`
4. THE Security_Middleware SHALL remove the `X-Powered-By` header from all responses
5. WHEN `CORS_ORIGIN` environment variable is set, THE Security_Middleware SHALL restrict CORS to that origin
6. WHEN `CORS_ORIGIN` is not set, THE Security_Middleware SHALL default to same-origin only

### Requirement 6: Persistent Brute Force Tracking

**User Story:** As a security engineer, I want brute force login tracking to persist across server restarts, so that attackers cannot bypass lockouts by triggering a restart.

#### Acceptance Criteria

1. WHEN a login attempt fails, THE Brute_Force_Store SHALL record the failure in the PostgreSQL `login_attempts` table keyed by IP and username
2. WHEN the failure count for a key reaches the configured maximum (default 5), THE Brute_Force_Store SHALL set a lockout timestamp
3. WHILE a lockout is active for a key, THE Server SHALL reject login attempts for that key with a 429 status and remaining lockout duration
4. WHEN a login succeeds, THE Brute_Force_Store SHALL clear the failure record for that key
5. THE Brute_Force_Store SHALL run a periodic cleanup that removes expired lockout records

### Requirement 7: Route Modularization

**User Story:** As a developer, I want the monolithic server.js decomposed into focused route modules, so that the codebase is maintainable and testable.

#### Acceptance Criteria

1. THE Server SHALL organize API routes into separate Express Router modules: auth, users, sites, sections, apps, upload, export, safety, and state
2. WHEN a route module is loaded, THE Server SHALL mount it under the appropriate URL prefix
3. THE Server SHALL contain only middleware setup, route mounting, and server startup logic after modularization
4. WHEN route modules are changed independently, THE Server SHALL continue to function without modifying other route modules

### Requirement 8: Async Error Handling

**User Story:** As a developer, I want all async route handlers wrapped with error catching, so that unhandled promise rejections do not crash the server.

#### Acceptance Criteria

1. THE Error_Handler SHALL provide an `asyncHandler` wrapper that catches rejected promises from route handlers
2. WHEN an async route handler throws an error, THE Error_Handler SHALL forward the error to the global error handler middleware
3. WHEN a `LIMIT_FILE_SIZE` error is caught, THE Error_Handler SHALL return a 413 response with a descriptive message
4. WHEN an unrecognized error is caught, THE Error_Handler SHALL return a 500 response with a generic error message and log the error details server-side
5. THE Error_Handler SHALL prevent unhandled promise rejections from terminating the Node.js process

### Requirement 9: Audit Logging

**User Story:** As a system administrator, I want security-relevant actions logged to the database, so that I can investigate incidents and maintain an audit trail.

#### Acceptance Criteria

1. WHEN a user logs in successfully, THE Audit_Logger SHALL record the action, username, and IP address to the `audit_log` table
2. WHEN a login attempt fails, THE Audit_Logger SHALL record the failed attempt with the attempted username and IP address
3. WHEN a user is created, deleted, or has their role changed, THE Audit_Logger SHALL record the action with the acting user and target user details
4. WHEN a password is changed, THE Audit_Logger SHALL record the action with the acting user's username
5. WHEN data is imported or exported, THE Audit_Logger SHALL record the action with relevant details
6. WHEN a site or section is created or deleted, THE Audit_Logger SHALL record the action with the resource name

### Requirement 10: Server-Side Pagination

**User Story:** As a developer, I want list endpoints to support server-side pagination, so that large datasets do not cause memory issues or slow responses.

#### Acceptance Criteria

1. WHEN a paginated endpoint is called, THE Pagination_Helper SHALL parse `page` and `limit` query parameters with defaults of 0 and 50 respectively
2. THE Pagination_Helper SHALL enforce a maximum limit of 500 items per page
3. WHEN a negative page number is provided, THE Pagination_Helper SHALL treat it as page 0
4. THE Server SHALL return paginated responses in the format `{ rows, total, page, limit, totalPages }`
5. THE Server SHALL ensure `rows.length` is less than or equal to `limit` in all paginated responses

### Requirement 11: Frontend Accessibility (ARIA and Keyboard Navigation)

**User Story:** As a user with assistive technology, I want interactive elements to have proper ARIA labels and keyboard navigation, so that I can use the application without a mouse.

#### Acceptance Criteria

1. THE Server SHALL serve HTML where all interactive buttons include an `aria-label` attribute describing their action
2. THE Server SHALL serve HTML where tab navigation elements use `role="tablist"`, `role="tab"`, and `role="tabpanel"` attributes
3. THE Server SHALL serve HTML where tab elements support keyboard navigation using arrow keys and manage `tabindex` and `aria-selected` attributes
4. THE Server SHALL serve HTML where form inputs have associated `label` elements or `aria-label` attributes

### Requirement 12: Test Suite

**User Story:** As a developer, I want an automated test suite covering critical paths, so that regressions are caught before deployment.

#### Acceptance Criteria

1. THE Server SHALL have unit tests for password hashing that verify bcrypt-only enforcement
2. THE Server SHALL have unit tests for the Session_Store covering create, get, touch, destroy, and cleanup operations
3. THE Server SHALL have unit tests for the Brute_Force_Store covering attempt recording, lockout, and clearing
4. THE Server SHALL have unit tests for the Upload_Validator covering acceptance and rejection of files by size, MIME type, and extension
5. THE Server SHALL have unit tests for the Pagination_Helper covering default values, boundary conditions, and maximum enforcement
6. THE Server SHALL have integration tests for the authentication flow using supertest

### Requirement 13: Migration Rollback Support

**User Story:** As a system administrator, I want database migrations to support rollback, so that failed migrations do not leave the database in a corrupted state.

#### Acceptance Criteria

1. WHEN a migration starts, THE Migration_Runner SHALL create a backup snapshot of the current database state
2. THE Migration_Runner SHALL execute all migration steps within a single database transaction
3. IF any migration step fails, THEN THE Migration_Runner SHALL roll back the transaction and preserve the backup file
4. WHEN a migration completes successfully, THE Migration_Runner SHALL commit the transaction and log success
5. THE Migration_Runner SHALL provide a restore command that can recover from a backup file

### Requirement 14: Naming Conventions

**User Story:** As a developer, I want consistent naming conventions across the codebase, so that the code is readable and predictable.

#### Acceptance Criteria

1. THE Server SHALL use camelCase for all JavaScript variable and function names
2. THE Server SHALL use snake_case for all PostgreSQL column names
3. THE Server SHALL use kebab-case for all route URL path segments
4. THE Server SHALL use consistent mapping between JavaScript camelCase properties and database snake_case columns in all query results

