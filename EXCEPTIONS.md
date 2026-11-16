# Dependency Audit Exceptions

This file documents `pnpm audit` findings that are not fixed by dependency upgrades, with rationale, severity, CVE references, and a next-review date.

Review cadence: every exception is re-evaluated **30 days** from the date listed below (next review: **2026-12-16**).

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High     | 18 |
| Moderate | 21 |
| Low      | 8 |

All remaining findings are **transitive dependencies** pulled in by NestJS, Angular CDK (via `@nestjs/cli`), webpack, TypeORM, bcrypt, or testing tooling. None are reachable through BoardSync application code paths in a way that is exploitable in production.

---

## multer (`2.0.2`) — 9 advisories

Transitive via `@nestjs/platform-express`. BoardSync does not use `multer` for file uploads; the attack surface is limited to built-in multipart parsing in Express.

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1113635 | CVE-2026-3304 | High | DoS via incomplete cleanup | Not exposed; no file upload endpoints in the public API. | 2026-12-16 |
| 1113636 | CVE-2026-2359 | High | DoS via resource exhaustion | Not exposed; no file upload endpoints. | 2026-12-16 |
| 1113996 | CVE-2026-3520 | High | DoS via uncontrolled recursion | Not exposed; no file upload endpoints. | 2026-12-16 |
| 1121089 | CVE-2026-5079 | High | DoS via deeply nested field names | Not exposed; no multipart form endpoints. | 2026-12-16 |
| 1121091 | CVE-2026-5038 | Moderate | DoS via incomplete cleanup of aborted uploads | Not exposed; no file upload endpoints. | 2026-12-16 |
| 1193790 | CVE-2026-77078 | High | DoS via crafted multipart field names | Not exposed; no multipart form endpoints. | 2026-12-16 |
| 1193792 | CVE-2026-77063 | Low | file size limit bypass via async fileFilter race | Not exposed; no file upload endpoints. | 2026-12-16 |
| 1193793 | CVE-2026-82333 | High | DoS via oversized array index in field names | Not exposed; no multipart form endpoints. | 2026-12-16 |
| 1243083 | CVE-2026-113872 | High | (unspecified) | Not exposed; no file upload endpoints. | 2026-12-16 |

---

## js-yaml (`4.1.0`) — 5 advisories

Transitive via `@nestjs/swagger`. BoardSync does not parse untrusted YAML documents; YAML is only used internally by Swagger for OpenAPI document generation.

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1112715 | CVE-2025-64718 | Moderate | Prototype pollution in merge (`<<`) | Not exposed; no untrusted YAML input. | 2026-12-16 |
| 1121860 | CVE-2026-53550 | Moderate | Quadratic DoS in merge key handling | Not exposed; no untrusted YAML input. | 2026-12-16 |
| 1123911 | CVE-2026-59869 | High | YAML merge-key chains quadratic CPU | Not exposed; no untrusted YAML input. | 2026-12-16 |
| 1138115 | (none) | High | Quadratic CPU in `!!omap` resolution | Not exposed; no untrusted YAML input. | 2026-12-16 |
| 1193727 | CVE-2026-84375 | High | maxTotalMergeKeys bypass via empty merge sources | Not exposed; no untrusted YAML input. | 2026-12-16 |

---

## minimatch (transitive) — 4 advisories

Transitive via `@nestjs/cli`, `@typescript-eslint`, `typeorm`, and `glob`. BoardSync does not accept user-controlled glob patterns.

| Advisory | Module | CVE | Severity | Title | Rationale | Next Review |
|----------|--------|-----|----------|-------|-----------|-------------|
| 1113465 | minimatch 9.0.3 | CVE-2026-26996 | High | ReDoS via repeated wildcards | Not exposed; no user-controlled glob patterns. | 2026-12-16 |
| 1113544 | minimatch 9.0.3 | CVE-2026-27903 | High | ReDoS via multiple GLOBSTAR segments | Not exposed; no user-controlled glob patterns. | 2026-12-16 |
| 1113552 | minimatch 9.0.3 | CVE-2026-27904 | High | ReDoS via nested extglobs | Not exposed; no user-controlled glob patterns. | 2026-12-16 |
| 1244623 | minimatch 9.0.9 | CVE-2026-118764 | Moderate | DoS via globparts amplification | Not exposed; no user-controlled glob patterns. | 2026-12-16 |

---

## qs (transitive) — 4 advisories

Transitive via `body-parser`, `express`, and `supertest`. BoardSync uses default `qs.parse` settings (no `arrayFormat: 'comma'`, no `encodeValuesOnly`, no `plainObjects`/`allowPrototypes`).

| Advisory | Module | CVE | Severity | Title | Rationale | Next Review |
|----------|--------|-----|----------|-------|-----------|-------------|
| 1119502 | qs 6.14.2 | CVE-2026-8723 | Moderate | TypeError on null/undefined in comma arrays | Not triggered; `encodeValuesOnly` not used. | 2026-12-16 |
| 1158506 | qs 6.14.2 | CVE-2026-82562 | Moderate | array-limit bypass via bracket-key comma parsing | Not triggered; `comma: true` not used. | 2026-12-16 |
| 1158507 | qs 6.14.2 | CVE-2026-82417 | Moderate | DoS via attacker-controlled `isBuffer` | Not triggered; `plainObjects`/`allowPrototypes` not used. | 2026-12-16 |
| 1243687 | qs 6.16.0 | CVE-2026-110816 | Moderate | TypeError on non-callable `toString` in comma arrays | Not triggered; `arrayFormat: 'comma'` not used. | 2026-12-16 |

---

## fast-uri (transitive) — 4 advisories

Transitive via `@nestjs/cli` (webpack chain) and `@seriousme/openapi-schema-validator`. BoardSync does not use `fast-uri` directly for host-based policy enforcement.

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1243098 | CVE-2026-110306 | Moderate | (unspecified) | Not exposed; no host-based URL policy enforcement. | 2026-12-16 |
| 1243101 | CVE-2026-110095 | Low | (unspecified) | Not exposed; no host-based URL policy enforcement. | 2026-12-16 |
| 1243104 | CVE-2026-110180 | Moderate | Host confusion via WHATWG canonicalization | Not exposed; no host-based URL policy enforcement. | 2026-12-16 |
| 1243107 | CVE-2026-110725 | Low | Scheme injection via suffix references | Not exposed; `reference: 'suffix'` not used. | 2026-12-16 |

---

## lodash (`4.17.21`) — 2 advisories

Transitive via `@nestjs/config` and `@nestjs/swagger`. BoardSync does not call `_.template` with untrusted `imports` key names.

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1115806 | CVE-2026-4800 | High | Code injection via `_.template` imports key names | Not exposed; no untrusted template imports. | 2026-12-16 |
| 1244531 | CVE-2025-13465 | Moderate | Prototype pollution in `_.unset`/`_.omit`/`_.pullAt` | Not exposed; no untrusted merge paths. | 2026-12-16 |

---

## file-type (`20.4.1`) — 2 advisories

Transitive via `@nestjs/common`. BoardSync does not detect file types from untrusted uploads.

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1114301 | CVE-2026-31808 | Moderate | Infinite loop in ASF parser | Not exposed; no file type detection from untrusted input. | 2026-12-16 |
| 1114726 | CVE-2026-32630 | Moderate | ZIP decompression bomb DoS | Not exposed; no file type detection from untrusted input. | 2026-12-16 |

---

## picomatch (`4.0.1`) — 2 advisories

Transitive via `@nestjs/cli` (Angular CDK). BoardSync does not process user-controlled glob patterns.

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1115551 | CVE-2026-33672 | Moderate | Method injection in POSIX character classes | Not exposed; no untrusted glob patterns. | 2026-12-16 |
| 1115554 | CVE-2026-33671 | High | ReDoS via extglob quantifiers | Not exposed; no untrusted glob patterns. | 2026-12-16 |

---

## @nestjs/core (`10.4.22`) — 1 advisory

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1117063 | CVE-2026-35515 | Moderate | SSE stream injection via `type`/`id` fields | BoardSync does not use Server-Sent Events (`SseStream`). | 2026-12-16 |

---

## uuid (`9.0.1`) — 1 advisory

Transitive via `@nestjs/typeorm`. BoardSync uses `randomUUID()` from Node's `crypto` module, not `uuid.v3/v5/v6` with caller-provided buffers.

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1119441 | CVE-2026-41907 | Moderate | Missing buffer bounds check in `v3`/`v5`/`v6` | Not exposed; `uuid` vulnerable APIs not called. | 2026-12-16 |

---

## glob (`10.4.5`) — 2 advisories

Transitive via `@nestjs/cli` and `typeorm`. BoardSync does not invoke the `glob` CLI with untrusted input.

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1109842 | CVE-2025-64756 | High | Command injection via `glob -c/--cmd` | Not exposed; CLI not invoked with user input. | 2026-12-16 |
| 1244013 | CVE-2026-118773 | Moderate | AbortSignal bypass allows post-traversal work | Not exposed; no glob traversal of attacker-controlled trees. | 2026-12-16 |

---

## tmp (`0.0.33`) — 2 advisories

Transitive via `@nestjs/cli` (inquirer chain). BoardSync does not create temp files with user-controlled `prefix`/`postfix`/`dir`.

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1109537 | CVE-2025-54798 | Low | Arbitrary temp file write via symlink `dir` | Not exposed; `tmp` not called with user-controlled paths. | 2026-12-16 |
| 1120654 | CVE-2026-44705 | High | Path traversal via prefix/postfix | Not exposed; `tmp` not called with user-controlled paths. | 2026-12-16 |

---

## webpack (`5.97.1`) — 2 advisories

Transitive via `@nestjs/cli`. BoardSync does not use `experiments.buildHttp`.

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1113041 | CVE-2025-68458 | Low | `allowedUris` bypass via URL userinfo | Not exposed; `buildHttp` not enabled. | 2026-12-16 |
| 1113042 | CVE-2025-68157 | Low | `allowedUris` bypass via HTTP redirects | Not exposed; `buildHttp` not enabled. | 2026-12-16 |

---

## body-parser (`1.20.4`) — 2 advisories

Transitive via `@nestjs/platform-express` (Express). BoardSync uses a fixed `limit` value (`'1mb'`), not a programmatically computed one.

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1123977 | CVE-2026-12590 | Low | DoS when invalid `limit` silently disables enforcement | Not exposed; `limit` is a hardcoded string literal. | 2026-12-16 |
| 1243073 | CVE-2026-111181 | High | (unspecified) | Not exposed; `limit` is a hardcoded string literal. | 2026-12-16 |

---

## ajv (`8.12.0`) — 1 advisory

Transitive via `@nestjs/cli` (Angular CDK). BoardSync uses `Joi` for validation, not `ajv` with `$data`.

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1113715 | CVE-2025-69873 | Moderate | ReDoS when using `$data` option | Not exposed; `$data` option not used; BoardSync uses Joi. | 2026-12-16 |

---

## deepmerge (`4.3.1`) — 1 advisory

Transitive via `@nestjs/cli` (webpack plugin chain). BoardSync does not call `deepmerge.mergeObject` with untrusted source objects.

| Advisory | CVE | Severity | Title | Rationale | Next Review |
|----------|-----|----------|-------|-----------|-------------|
| 1243505 | CVE-2026-93753 | Low | Prototype poisoning in `mergeObject()` | Not exposed; no untrusted merge operations. | 2026-12-16 |

---

## Fixed in this change (for reference)

| Module | From | To | CVE(s) fixed |
|--------|------|-----|--------------|
| `bcrypt` | 5.1.1 | 6.0.0 | CVE-2026-59873 (tar Gzip bomb, Critical) |
| `ts-jest` | 29.1.1 | 29.4.15 | CVE-2026-106446, CVE-2026-106445 (handlebars RCE, Critical) |
| `joi` | 18.2.9 | 18.3.2 | CVE-2026-118772 (DoS, High) |
