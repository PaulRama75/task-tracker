# Implementation Plan: System QA Hardening

## Overview

Harden the Task Tracker application by addressing 16 QA issues in dependency order: critical/security fixes first (config, bcrypt, sessions, brute force, uploads, security headers), then code quality refactoring (route modularization, async error handling, audit logging, pagination, naming), then frontend accessibility, migration rollback, and test suite. Each task builds on previous work so there is no orphaned code.

## Tasks

- [x] 1. Centralized configuration and hardcoded path removal
  - [x] 1.1 Create `config.js` module
    - Read all settings from environment variables (`PORT`, `DB_*`, `TRACKER_DIR`, `SESSION_TIMEOUT`, `MAX_LOGIN_ATTEMPTS`, `LOCKOUT_DURATION`, `CORS_ORIGIN`, `MAX_FILE_SIZE`)
    - Provide sensible defaults for development; throw on missing required DB vars in production
    - Return `null` for `TRACKER_DIR` when unset (no hardcoded Windows path)
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 1.2 Create `.env.example` file
    - Document all environment variables with placeholder values
    - _Requirements: 1.1_

  - [x] 1.3 Update `server.js` and `db.js` to import from `config.js`
    - Replace all hardcoded `TRACKER_DIR`, `PORT`, `SESSION_TIMEOUT`, `MAX_LOGIN_ATTEMPTS`, `LOCKOUT_DURATION` references
    - Guard auto-import behind `config.trackerDir !== null` check
    - Remove the hardcoded `C:/Users/...` path
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Enforce bcrypt-only password hashing
  - [x] 2.1 Remove SHA256 fallback from `server.js`
    - Delete `hashPassword(password, salt)` function using `crypto.createHash('sha256')`
    - Remove `try { bcrypt = require('bcrypt') } catch` pattern — make bcrypt a hard require
    - Update `hashPasswordSecure` to always use bcrypt (cost factor 12)
    - Update `verifyPassword` to only use `bcrypt.compare` (remove SHA256 branch)
    - Add startup check: if `require('bcrypt')` fails, log clear error and `process.exit(1)`
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [ ]* 2.2 Write property test: password hashing round-trip
    - **Property 1: Password hashing round-trip**
    - For any valid password string, `hashPasswordSecure` then `bcrypt.compare` with original returns true; compare with different password returns false
    - **Validates: Requirements 3.1, 3.4**

- [x] 3. Persistent session storage
  - [x] 3.1 Add `sessions` table schema to `db.js` `initDB()`
    - Create table with columns: `token VARCHAR(64) PRIMARY KEY`, `username`, `role`, `created_at`, `last_activity`, `expires_at`
    - Add indexes on `expires_at` and `username`
    - _Requirements: 2.1_

  - [x] 3.2 Create `middleware/sessionStore.js` — `PgSessionStore` class
    - Implement `create(token, sessionData)`, `get(token)`, `touch(token)`, `destroy(token)`, `destroyByUsername(username)`, `cleanup()`
    - `get` returns null for expired sessions
    - `cleanup` deletes rows where `expires_at < NOW()`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 3.3 Replace in-memory `sessions` object in `server.js` with `PgSessionStore`
    - Update login route to call `sessionStore.create()`
    - Update logout route to call `sessionStore.destroy()`
    - Update `authRequired` to call `sessionStore.get()` and `sessionStore.touch()`
    - Replace `setInterval` cleanup with `sessionStore.cleanup()` on interval
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 3.4 Write property test: session store round-trip
    - **Property 2: Session store round-trip**
    - Create session → get returns equivalent data; destroy → get returns null
    - **Validates: Requirements 2.1, 2.2, 2.6**

  - [ ]* 3.5 Write property test: session activity tracking
    - **Property 3: Session activity tracking**
    - Calling `touch(token)` updates `last_activity` to >= previous value
    - **Validates: Requirement 2.3**

  - [ ]* 3.6 Write property test: session expiry enforcement
    - **Property 4: Session expiry enforcement**
    - Sessions past timeout are rejected by auth middleware and removed by cleanup
    - **Validates: Requirements 2.4, 2.5**

- [x] 4. Persistent brute force tracking
  - [x] 4.1 Add `login_attempts` table schema to `db.js` `initDB()`
    - Create table with columns: `key VARCHAR(255) PRIMARY KEY`, `attempt_count`, `locked_until`, `last_attempt`
    - _Requirements: 6.1_

  - [x] 4.2 Create `middleware/bruteForceStore.js` — `PgBruteForceStore` class
    - Implement `check(key)`, `recordFailure(key)`, `clear(key)`, `cleanup()`
    - `recordFailure` upserts attempt count; sets lockout when count >= max
    - `cleanup` deletes records where `locked_until < NOW()`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 4.3 Replace in-memory `loginAttempts` in `server.js` with `PgBruteForceStore`
    - Update login route to use `bruteForceStore.check()`, `recordFailure()`, `clear()`
    - Wire periodic cleanup
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ]* 4.4 Write property test: brute force lockout cycle
    - **Property 7: Brute force lockout cycle**
    - N consecutive failures → lockout; while locked → 429; after clear → no lockout
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [ ]* 4.5 Write property test: brute force cleanup
    - **Property 8: Brute force cleanup**
    - After cleanup, no records with `locked_until` in the past remain
    - **Validates: Requirement 6.5**

- [x] 5. Checkpoint — Critical security fixes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. File upload validation
  - [x] 6.1 Create `middleware/uploadValidation.js`
    - Configure multer with `fileFilter` checking MIME type and extension (xlsx, xls, csv)
    - Set `limits.fileSize` to `config.maxFileSize` (default 10MB)
    - Export configured multer instance and standalone `validateUpload(file)` function
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x] 6.2 Update upload routes in `server.js` to use validated multer
    - Replace raw `upload` with validated upload middleware
    - Add temp file cleanup in error paths (`fs.unlink` on failure)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 6.3 Write property test: file upload validation determinism
    - **Property 5: File upload validation determinism**
    - For any file object, validation accepts iff extension matches AND MIME matches AND size ≤ 10MB; result is deterministic
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4**

- [x] 7. Security headers (CSP, CORS, HSTS)
  - [x] 7.1 Create `middleware/security.js`
    - Configure helmet with explicit CSP directives: `default-src 'self'`, `script-src 'self' https://cdn.jsdelivr.net`, `style-src 'self' 'unsafe-inline'`, `object-src 'none'`, `frame-ancestors 'self'`
    - Enable HSTS with `maxAge: 31536000`
    - Configure cors using `config.corsOrigin`
    - Ensure `X-Powered-By` is removed
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 7.2 Install `cors` dependency and wire `middleware/security.js` into `server.js`
    - Replace existing helmet setup with `setupSecurity(app)` call
    - Remove `try { helmet = require('helmet') } catch` pattern — make helmet a hard require
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 7.3 Write property test: security headers presence
    - **Property 6: Security headers presence**
    - Every HTTP response includes CSP with required directives and does not include `X-Powered-By`
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [x] 8. Async error handling
  - [x] 8.1 Create `middleware/errorHandler.js`
    - Implement `asyncHandler(fn)` wrapper that catches promise rejections and calls `next(err)`
    - Implement `globalErrorHandler(err, req, res, next)` that handles `LIMIT_FILE_SIZE` (413), file validation errors (400), and generic errors (500)
    - Log error details server-side; return generic message to client
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 8.2 Wrap all async route handlers in `server.js` with `asyncHandler`
    - Apply to every `async (req, res)` route handler
    - Mount `globalErrorHandler` as last middleware
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ]* 8.3 Write property test: async error handler forwarding
    - **Property 9: Async error handler forwarding**
    - Any async function that throws, when wrapped with `asyncHandler`, calls `next(err)`; unrecognized errors return 500
    - **Validates: Requirements 8.1, 8.2, 8.4**

- [x] 9. Audit logging
  - [x] 9.1 Add `audit_log` table schema to `db.js` `initDB()`
    - Create table with columns: `id SERIAL PRIMARY KEY`, `action`, `username`, `ip_address`, `details JSONB`, `created_at`
    - Add indexes on `action`, `created_at DESC`, `username`
    - _Requirements: 9.1_

  - [x] 9.2 Create `middleware/audit.js`
    - Implement `auditLog(action, username, details, req)` function
    - Extract IP from `req.ip` or `req.connection.remoteAddress`
    - Insert into `audit_log` table (fire-and-forget with error logging)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [x] 9.3 Add audit calls to all state-mutating routes
    - Login success/failure, logout, user CRUD, password change, role change, site/section CRUD, data import/export
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ]* 9.4 Write property test: audit log completeness
    - **Property 10: Audit log completeness**
    - Every state-mutating API call creates an audit entry with action, username, and IP
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6**

- [x] 10. Checkpoint — Security hardening and error handling
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Route modularization
  - [x] 11.1 Create route module files
    - Create `routes/auth.js`, `routes/users.js`, `routes/sites.js`, `routes/sections.js`, `routes/apps.js`, `routes/upload.js`, `routes/export.js`, `routes/safety.js`, `routes/state.js`
    - Move corresponding route handlers from `server.js` into each module
    - Each module exports an Express Router
    - Wrap all async handlers with `asyncHandler`
    - Include audit logging calls
    - _Requirements: 7.1, 7.2, 7.4_

  - [x] 11.2 Refactor `server.js` to mount route modules
    - Replace inline route definitions with `app.use('/api', require('./routes/auth'))` etc.
    - Keep only middleware setup, route mounting, DB init, and server startup in `server.js`
    - Target ~50-80 lines for the refactored `server.js`
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 12. Server-side pagination
  - [x] 12.1 Create pagination helper utility
    - Implement `parsePagination(req, defaultLimit, maxLimit)` returning `{ page, limit, offset }`
    - Clamp page >= 0, 1 <= limit <= 500, defaults page=0 limit=50
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 12.2 Add paginated query functions to `db.js`
    - Add `getTrackerRowsPaginated(sectionId, offset, limit)` returning `{ rows, total }`
    - Add `getAuditLogPaginated(offset, limit, filters)` returning `{ rows, total }`
    - _Requirements: 10.4, 10.5_

  - [x] 12.3 Update list endpoints to use pagination
    - Apply to tracker rows, audit log, and JSA records endpoints
    - Return response format `{ rows, total, page, limit, totalPages }`
    - _Requirements: 10.4, 10.5_

  - [ ]* 12.4 Write property test: pagination parameter bounds
    - **Property 11: Pagination parameter bounds**
    - For any (page, limit) input, result has page >= 0, 1 <= limit <= 500, offset = page * limit
    - **Validates: Requirements 10.1, 10.2, 10.3**

  - [ ]* 12.5 Write property test: pagination response invariants
    - **Property 12: Pagination response invariants**
    - Response contains rows, total, page, limit, totalPages; rows.length <= limit; totalPages = ceil(total/limit)
    - **Validates: Requirements 10.4, 10.5**

- [x] 13. Naming conventions consistency
  - [x] 13.1 Audit and fix JavaScript naming to camelCase
    - Ensure all variables and functions use camelCase
    - Ensure all PostgreSQL columns use snake_case (already mostly correct)
    - Ensure route URL paths use kebab-case
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 13.2 Ensure consistent camelCase ↔ snake_case mapping in DB query results
    - Review all `db.js` query result mappings (e.g., `password_hash` → `passwordHash`)
    - Fix any inconsistencies in the mapping layer
    - _Requirements: 14.4_

  - [ ]* 13.3 Write property test: data mapping round-trip
    - **Property 15: Data mapping round-trip**
    - Writing a JS object to DB and reading it back with snake_case → camelCase mapping produces equivalent object
    - **Validates: Requirement 14.4**

- [x] 14. Checkpoint — Code quality refactoring
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Frontend accessibility
  - [x] 15.1 Add ARIA attributes to `public/index.html`
    - Add `aria-label` to all interactive buttons
    - Add `role="tablist"`, `role="tab"`, `role="tabpanel"` to tab navigation
    - Add `aria-selected`, `tabindex` management for tabs
    - Add `label` or `aria-label` to all form inputs
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 15.2 Add ARIA attributes to `public/users/index.html`
    - Add `aria-label` to buttons and form inputs
    - Ensure keyboard navigability
    - _Requirements: 11.1, 11.4_

  - [x] 15.3 Add ARIA attributes to `public/safety/*.html` pages
    - Add `aria-label` to buttons and form inputs across form.html, index.html, records.html
    - _Requirements: 11.1, 11.4_

  - [x] 15.4 Add keyboard navigation JavaScript for tab components
    - Implement arrow key navigation between tabs
    - Manage `tabindex` and `aria-selected` on tab switch
    - _Requirements: 11.3_

- [x] 16. Migration rollback support
  - [x] 16.1 Enhance `migrate-to-db.js` with transaction wrapping and backup
    - Wrap all migration steps in a single DB transaction
    - Create a JSON backup snapshot before migration starts
    - On failure: rollback transaction, preserve backup file, log error
    - On success: commit transaction, log success
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 16.2 Add `--restore` CLI flag to `migrate-to-db.js`
    - Accept a backup file path and restore DB state from it
    - _Requirements: 13.5_

  - [ ]* 16.3 Write property test: migration atomicity
    - **Property 14: Migration atomicity**
    - If any step fails, DB state equals pre-migration state and backup file exists; if all succeed, data is committed
    - **Validates: Requirements 13.2, 13.3, 13.4**

- [x] 17. Test suite setup and integration tests
  - [x] 17.1 Set up Jest and Supertest
    - Install `jest`, `supertest`, `fast-check` as dev dependencies
    - Add `"test"` script to `package.json`
    - Create `jest.config.js` with appropriate settings
    - _Requirements: 12.1_

  - [ ]* 17.2 Write unit tests for password hashing
    - Verify bcrypt-only enforcement, correct cost factor, round-trip verification
    - _Requirements: 12.1_

  - [ ]* 17.3 Write unit tests for Session_Store
    - Test create, get, touch, destroy, cleanup operations
    - _Requirements: 12.2_

  - [ ]* 17.4 Write unit tests for Brute_Force_Store
    - Test attempt recording, lockout threshold, clearing, cleanup
    - _Requirements: 12.3_

  - [ ]* 17.5 Write unit tests for Upload_Validator
    - Test acceptance/rejection by size, MIME type, and extension
    - _Requirements: 12.4_

  - [ ]* 17.6 Write unit tests for Pagination_Helper
    - Test defaults, negative page, zero limit, max enforcement
    - _Requirements: 12.5_

  - [ ]* 17.7 Write integration tests for auth flow
    - Test login → token → protected route → logout using supertest
    - _Requirements: 12.6_

- [ ] 18. Configuration environment variable property test
  - [ ]* 18.1 Write property test: config env var resolution
    - **Property 13: Configuration environment variable resolution**
    - For any value of `TRACKER_DIR`, Config_Loader returns that value; when unset, returns null
    - **Validates: Requirement 1.1**

- [x] 19. Final checkpoint — All tasks complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each major phase
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- Dependencies flow top-down: config → bcrypt → sessions → brute force → uploads → headers → error handling → audit → routes → pagination → naming → accessibility → migration → tests
