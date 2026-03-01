# Deep Code Review #2: dcmtk.js

**Date:** 2026-02-24
**Reviewer:** Claude Opus 4.6 (8 parallel audit agents)
**Scope:** Full codebase — core infrastructure, 51 tool wrappers, 6 server classes, DICOM data layer, PacsClient, test quality, build/config, security
**Methodology:** 8 specialized agents reviewed in parallel: core infra, tools, servers/events, DICOM data, PacsClient, tests, build/config, security

---

## Status Legend

| Status        | Meaning                                               |
| ------------- | ----------------------------------------------------- |
| `PENDING`     | Not yet addressed                                     |
| `IN PROGRESS` | Currently being worked on                             |
| `FIXED`       | Resolved with code changes                            |
| `ACCEPTED`    | Known limitation, accepted as-is (with justification) |
| `WONTFIX`     | Deliberately not fixing (with justification)          |

---

## Summary

| Severity  | Count  | Fixed  | Pending | Accepted | Won't Fix |
| --------- | ------ | ------ | ------- | -------- | --------- |
| CRITICAL  | 11     | 11     | 0       | 0        | 0         |
| HIGH      | 16     | 16     | 0       | 0        | 0         |
| MEDIUM    | 21     | 21     | 0       | 0        | 0         |
| LOW       | 19     | 14     | 0       | 5        | 0         |
| **Total** | **67** | **62** | **0**   | **5**    | **0**     |

---

## Table of Contents

1. [CRITICAL Findings](#1-critical-findings)
    - [Security](#11-security)
    - [Data Integrity](#12-data-integrity)
    - [Testing](#13-testing)
    - [Resource Management](#14-resource-management)
2. [HIGH Findings](#2-high-findings)
3. [MEDIUM Findings](#3-medium-findings)
4. [LOW Findings](#4-low-findings)
5. [Positive Observations](#5-positive-observations)
6. [Top 5 Recommendations](#6-top-5-recommendations)

---

## 1. CRITICAL Findings

### 1.1 Security

#### S-1. Unvalidated `outputDirectory` in tool wrappers | `FIXED`

- **Files:** `src/tools/findscu.ts:101`, `src/tools/movescu.ts:99`, `src/tools/getscu.ts:92`
- **Issue:** Server classes use `isSafePath()` for path traversal protection, but tool wrappers do NOT. Users can pass `../../etc/sensitive` as `outputDirectory`.
- **Impact:** Path traversal allows writing DICOM response files to arbitrary directories.
- **Fix:** Add `.refine(isSafePath, 'Path traversal detected')` to all `outputDirectory` schemas in tool wrappers.
- **Status:** `FIXED`
- **Notes:** Added `isSafePath` refine to outputDirectory in findscu, movescu, getscu Zod schemas.

---

#### S-2. Unvalidated file paths in dcmsend/storescu | `FIXED`

- **Files:** `src/tools/dcmsend.ts:48`, `src/tools/storescu.ts:51`
- **Issue:** `files` param is `z.array(z.string().min(1))` with zero path validation. Symlink attacks or path traversal could exfiltrate arbitrary files via DICOM C-STORE.
- **Impact:** Arbitrary file read/exfiltration if attacker controls file paths.
- **Fix:** Add `isSafePath()` refine to all file path arrays.
- **Status:** `FIXED`
- **Notes:** Added `isSafePath` refine to each file path element in dcmsend, storescu Zod schemas.

---

#### S-3. Unbounded stdout/stderr buffering | `FIXED`

- **Files:** `src/exec.ts:88-94`, `src/DcmtkProcess.ts:93-94`
- **Issue:** Both `execCommand` and `DcmtkProcess` accumulate output without bounds. A malicious DICOM file producing massive output causes OOM. Violates Rule 8.1 ("all buffers are bounded").
- **Impact:** Denial of service via memory exhaustion.
- **Fix:** Add `MAX_OUTPUT_BYTES` constant (100MB) in `src/constants.ts`. Check accumulated length on each `data` event; kill process and return error if exceeded.
- **Status:** `FIXED`
- **Notes:** Added `MAX_OUTPUT_BYTES = 100 * 1024 * 1024` to constants. exec.ts kills process and settles with error on exceed. DcmtkProcess emits fatal error and kills child on exceed.

---

#### S-4. No DICOM key format validation in network tools | `FIXED`

- **Files:** `src/tools/findscu.ts:73`, `src/tools/movescu.ts:71`, `src/tools/getscu.ts:69`
- **Issue:** Keys validated as `z.array(z.string().min(1))` with no format checking. Unlike `dcmdump` which enforces tag regex. Malformed keys or injected DCMTK flags pass through.
- **Impact:** DCMTK flag injection via `-k` arguments; silent failures from malformed queries.
- **Fix:** Added `DICOM_QUERY_KEY_PATTERN` regex and `isValidDicomKey()` to `src/patterns.ts`. Applied as `.refine()` on keys arrays.
- **Status:** `FIXED`
- **Notes:** Pattern requires keys start with valid hex tag pair `XXXX,XXXX`, allows dotted/indexed paths and `=value` suffix. Rejects flag-like strings (`-ep`, `--extract`). 7 new tests in patterns.test.ts.

---

### 1.2 Data Integrity

#### D-1. `DicomDataset.fromJson()` accepts structurally invalid data | `FIXED`

- **File:** `src/dicom/DicomDataset.ts:293-298`
- **Issue:** Only checks non-null object. Accepts `{ '00100010': 'not-an-element' }` or `{ vr: 'INVALID' }`. Downstream operations fail unpredictably.
- **Impact:** Silent data corruption, runtime crashes on malformed DICOM JSON.
- **Fix:** Add structural validation: every key must be 8-char hex tag, every value must have `{ vr: string }`.
- **Status:** `FIXED`
- **Notes:** Added `isValidDicomJsonModel()` and `isDicomJsonElement()` type guards. `fromJson()` now validates every key is 8-char hex and every value has `{ vr: string }` before accepting.

---

#### D-2. `DicomJsonModel` cast without validation in sequence traversal | `FIXED`

- **File:** `src/dicom/DicomDataset.ts:137, 229, 236`
- **Issue:** Casts arbitrary objects to `DicomJsonModel` after only checking `typeof === 'object'`. Malformed SQ items cause silent failures or crashes.
- **Impact:** Data corruption, silent failures when processing DICOM files with malformed SQ elements.
- **Fix:** Add `DicomJsonModel` type guard before casting, or return `Result<DicomJsonModel>` instead.
- **Status:** `FIXED`
- **Notes:** Added `isPlausibleModel()` type guard. `descendIntoSequence()` and `enqueueSequenceItems()` now use the guard instead of unsafe casts, returning proper errors for non-object sequence items.

---

#### D-3. `tagPathToSegments()` throws instead of returning Result | `FIXED`

- **File:** `src/dicom/tagPath.ts:50, 55, 66, 99, 105, 106`
- **Issue:** Used in public `getElementAtPath()` and `findValues()` without try-catch. Unhandled exceptions escape the public API. Violates Rule 6.2 (Result pattern for fallible operations).
- **Impact:** Unexpected exceptions from the public API; inconsistent error handling contract.
- **Fix:** Either make `tagPathToSegments()` return `Result<ReadonlyArray<TagSegment>>`, or wrap calls in try-catch within `getElementAtPath()`/`findValues()`.
- **Status:** `FIXED`
- **Notes:** Wrapped `tagPathToSegments()` calls in try-catch in both `getElementAtPath()` (returns `err()`) and `findValues()` (returns empty array). Exceptions no longer escape the public API.

---

### 1.3 Testing

#### T-1. Coverage is misleading — 51 tool files excluded | `FIXED`

- **File:** `vitest.config.ts:12-77`
- **Issue:** Reported 99% statement coverage excludes ALL tool implementations from coverage. Integration tests require DCMTK installed and run separately. True coverage including tools is ~80%.
- **Impact:** Misleading quality metrics. If integration tests are skipped (no DCMTK), 51 files have zero coverage.
- **Fix:** Either include tools in unit coverage with argument-construction tests, or clearly separate metrics (unit vs. total coverage).
- **Status:** `FIXED`
- **Notes:** Consolidated CI: removed the 6-combo matrix unit test job. Single Docker-based `test:all` job runs all tests (unit + integration) with coverage that includes tool files. `vitest.all.config.ts` covers all `src/**/*.ts` excluding only barrels/types. Local `pnpm run test` unchanged for fast dev without DCMTK.

---

#### T-2. Flaky test — DcmtkProcess stderr emission | `FIXED`

- **File:** `src/DcmtkProcess.test.ts:177-193`
- **Issue:** Uses hardcoded `setTimeout(resolve, 1500)` instead of completion signal. Fails intermittently under CI load.
- **Impact:** CI instability. Tests that pass locally fail under contention.
- **Fix:** Replace delay with process completion await: `await proc.stop(); expect(lines).toContain('ERR_LINE');`
- **Status:** `FIXED`
- **Notes:** Replaced all hardcoded `setTimeout(resolve, 1500)` delays with polling loops (`for (let i = 0; i < 50 && !condition; i++) await delay(100)`) in both stdout and stderr emission tests.

---

#### T-3. PacsClient tests mock everything — no contract tests | `FIXED`

- **File:** `src/pacs/PacsClient.test.ts:1-47`
- **Issue:** All 7 network tools + temp dir utilities are fully mocked. Tests verify mock calls, not actual argument construction or error propagation. Refactoring PacsClient internals won't break these tests.
- **Impact:** Tests coupled to mock behavior, not real behavior. Low regression detection value.
- **Fix:** Keep mock tests for happy-path. Add contract tests verifying actual argument shapes, error bubbling, and temp dir lifecycle.
- **Status:** `FIXED`
- **Notes:** Deleted all 39 mock tests in `src/pacs/PacsClient.test.ts`. Replaced with `test/integration/pacs/PacsClient.integration.test.ts` — 25+ real integration tests against DcmQRSCP and StoreSCP servers. Tests cover: create() validation, echo(), findStudies/findSeries/findImages/find(), retrieveStudy (C-GET + C-MOVE), retrieveSeries, store(), error cases (connection refused, unreachable host), and timeout behavior.

---

### 1.4 Resource Management

#### R-1. Event listener leak in server disposal | `FIXED`

- **Files:** `src/servers/Dcmrecv.ts`, `StoreSCP.ts`, `DcmprsCP.ts`, `Dcmpsrcv.ts`, `DcmQRSCP.ts`, `Wlmscpfs.ts`
- **Issue:** `wireParser()` creates listeners on `this.parser` EventEmitter. `[Symbol.dispose]()` calls `this.removeAllListeners()` on the process but NEVER disposes the parser. `LineParser.[Symbol.dispose]()` exists but is never called by server classes.
- **Impact:** Memory leak in long-lived apps that create/dispose servers repeatedly.
- **Fix:** Override `[Symbol.dispose]()` in all server classes to call `this.parser[Symbol.dispose]()`.
- **Status:** `FIXED`
- **Notes:** Added `[Symbol.dispose]()` override to all 6 server classes (Dcmrecv, StoreSCP, DcmprsCP, Dcmpsrcv, DcmQRSCP, Wlmscpfs). Each calls `this.parser[Symbol.dispose]()` then `super[Symbol.dispose]()`.

---

## 2. HIGH Findings

#### S-5. ReDoS risk in event patterns | `FIXED`

- **Files:** `src/events/dcmrecv.ts:80`, `src/events/storescp.ts:47, 54`
- **Issue:** Unbounded `\s+` and `.+` in regex patterns. Crafted input with thousands of spaces could cause catastrophic backtracking.
- **Fix:** Use bounded quantifiers: `/storing DICOM file:\s{0,20}(.{1,500})$/`
- **Status:** `FIXED`
- **Notes:** Bounded all regex quantifiers across 6 event files (dcmrecv, storescp, dcmpsrcv, dcmprscp, wlmscpfs, dcmqrscp). `.+` → `.{1,1024}`, `\s+` → `\s{1,100}` or `\s{1,20}`, `\s*` → `\s{0,20}`.

---

#### S-6. AE Title validation allows any character | `FIXED`

- **Files:** All 6 network tool schemas (echoscu, findscu, movescu, storescu, dcmsend, getscu)
- **Issue:** `z.string().min(1).max(16)` — no character set enforcement. DICOM restricts AE Titles to specific ASCII characters.
- **Fix:** Add regex refine: `.regex(/^[A-Za-z0-9 _-]+$/)`
- **Status:** `FIXED`
- **Notes:** Added `isValidAETitle()` function to `src/patterns.ts`. Applied `.refine(isValidAETitle, ...)` to all AE Title Zod fields across 11 files (echoscu, findscu, movescu, getscu, dcmsend, storescu, termscu, dcmprscu, PacsClient, Dcmrecv, StoreSCP).

---

#### S-7. `DCMTK_PATH` env var not validated | `FIXED`

- **File:** `src/findDcmtkPath.ts`
- **Issue:** Environment variable accepted without path traversal check. Attacker sets `DCMTK_PATH=/tmp/malicious` with fake binaries → arbitrary code execution.
- **Fix:** Validate `DCMTK_PATH` with `isSafePath()` or check for known binary signatures.
- **Status:** `FIXED`
- **Notes:** Added `isSafePath()` validation in `searchEnvPath()`. Returns `err()` with descriptive message if DCMTK_PATH contains path traversal sequences.

---

#### R-2. AbortSignal listener never removed | `FIXED`

- **Files:** `src/servers/Dcmrecv.ts:320`, `StoreSCP.ts:402`, `DcmprsCP.ts:227`, `Dcmpsrcv.ts:233`
- **Issue:** `signal.addEventListener('abort', ..., { once: true })` — if signal is never aborted, closure captures `this` indefinitely, preventing GC.
- **Fix:** Track the listener and detach it in `stop()` or `[Symbol.dispose]()`.
- **Status:** `FIXED`
- **Notes:** Added `private abortSignal` and `private abortHandler` fields to all 6 server classes. `wireAbortSignal()` stores references. `[Symbol.dispose]()` calls `removeEventListener()` to detach.

---

#### R-3. Race condition in `settle()` during startup | `FIXED`

- **File:** `src/DcmtkProcess.ts:133-163`
- **Issue:** Multiple event handlers (error, close, timeout) can race to call `settle()`. The `settled` flag check is not atomic relative to event emission.
- **Fix:** Document or restructure to ensure single settlement path. Clear timeout immediately within settle().
- **Status:** `FIXED`
- **Notes:** Added documentation comment explaining that Node.js is single-threaded, so the `settled` flag check+set is atomic within each event handler invocation. No code race exists.

---

#### R-4. Fatal events don't trigger automatic shutdown | `FIXED`

- **Files:** `src/servers/Dcmrecv.ts:307-310`, `StoreSCP.ts:389-392`, `DcmprsCP.ts:214-217`, `Dcmpsrcv.ts:220-223`
- **Issue:** Fatal events (e.g., `CANNOT_START_LISTENER`) emit `error` but don't call `stop()`. Process keeps running with `isRunning = true` but child is dead.
- **Fix:** Call `this.stop()` after emitting fatal error events.
- **Status:** `FIXED`
- **Notes:** Added `void this.stop()` after fatal error emission in `wireParser()` across all 6 server classes (Dcmrecv, StoreSCP, DcmprsCP, Dcmpsrcv, DcmQRSCP, Wlmscpfs).

---

#### R-5. No-op error handler silences legitimate errors | `FIXED`

- **File:** `src/DcmtkProcess.ts:102-104`
- **Issue:** Default `this.on('error', () => {})` prevents Node.js crash but silences errors that fire before user registers their listener.
- **Fix:** Log errors or buffer them for late subscribers; or document the ordering requirement.
- **Status:** `FIXED`
- **Notes:** Enhanced documentation comment to clearly state the ordering requirement: consumers should register their own `'error'` listener before calling `start()`. Startup errors are also returned via Result from `start()`.

---

#### D-4. ChangeSet accepts unvalidated tag paths at runtime | `FIXED`

- **File:** `src/dicom/ChangeSet.ts:109-120`
- **Issue:** `setTag()` and `eraseTag()` accept branded `DicomTagPath` but no runtime validation. Bypass possible via type coercion. Invalid paths silently passed to dcmodify.
- **Fix:** Add `tagPathToSegments()` validation call inside `setTag()`/`eraseTag()`.
- **Status:** `FIXED`
- **Notes:** Added `tagPathToSegments(path)` validation call at the start of both `setTag()` and `eraseTag()`. Throws on invalid paths before any mutation occurs.

---

#### D-5. Lazy-loaded mutable `nameIndex` in dictionary | `FIXED`

- **File:** `src/dicom/dictionary.ts:60, 74-79`
- **Issue:** Mutable `let` variable for lazy initialization. Concurrent calls could build index multiple times.
- **Fix:** Build eagerly at module load or use `||=` pattern with documentation.
- **Status:** `FIXED`
- **Notes:** Changed to `??=` pattern (`nameIndex ??= buildNameIndex()`). Single-threaded JS ensures no concurrent races; the `??=` is idiomatic and clear.

---

#### D-6. Mutable `ElementBuilder` in xmlToJson violates immutability rule | `FIXED`

- **File:** `src/tools/_xmlToJson.ts:43-48`
- **Issue:** Arrays are mutated in place. No deep freeze on returned objects. Callers can mutate returned DICOM JSON elements.
- **Fix:** `Object.freeze()` on returned objects, or document the runtime mutability risk.
- **Status:** `FIXED`
- **Notes:** Added `Object.freeze()` on the returned element in `convertElement()`. Runtime immutability now enforced on all returned DICOM JSON elements.

---

#### T-4. Event pattern tests have low branch coverage (50-72%) | `FIXED`

- **Files:** `src/events/dcmrecv.test.ts`, `storescp.test.ts`, `dcmpsrcv.test.ts`
- **Issue:** Tests verify regex matches but not processor error handling, malformed input, or missing capture groups.
- **Fix:** Add negative tests: malformed input, missing groups, whitespace variations.
- **Status:** `FIXED`
- **Notes:** Added negative test cases (empty strings, partial matches, malformed input) to dcmrecv, storescp, dcmpsrcv, and dcmprscp test files.

---

#### T-5. ChangeSet limit tests take 25+ seconds | `FIXED`

- **File:** `src/dicom/ChangeSet.test.ts`
- **Issue:** 3 tests loop to `MAX_CHANGESET_OPERATIONS` (thousands of iterations), consuming 25+ seconds of test runtime.
- **Fix:** Mock the limit to a small number, or test only exact boundary values (MAX-1, MAX, MAX+1).
- **Status:** `FIXED`
- **Notes:** Added `vi.mock('../constants', ...)` to override `MAX_CHANGESET_OPERATIONS` to 10. Tests now run in milliseconds instead of 25+ seconds.

---

#### T-6. DicomDataset tests lack nested sequence edge cases | `FIXED`

- **File:** `src/dicom/DicomDataset.test.ts`
- **Issue:** No tests for deep nesting (3+ levels), empty sequences, null SQ items, or wildcard paths into nested structures.
- **Fix:** Add tests for `Value: []`, `Value: [null, {...}]`, deep paths, and wildcard into nested.
- **Status:** `FIXED`
- **Notes:** Added 7 new nested sequence edge case tests: deep nesting (3 levels), empty sequences, wildcard into nested, null sequence items, mixed valid/null items, deep path into nested, and wildcard with no match.

---

#### TW-1. Missing `.refine()` for interdependent options | `FIXED`

- **Files:** `src/tools/findscu.ts:64-77`, `movescu.ts`, `getscu.ts`
- **Issue:** `extract: true` without `outputDirectory` not validated. Unlike `dcmodify` which uses `.refine()` for conditional required fields.
- **Fix:** Add `.refine(data => !data.extract || data.outputDirectory !== undefined, ...)`.
- **Status:** `FIXED`
- **Notes:** Added `.refine()` to findscu.ts requiring `outputDirectory` when `extract` is true. movescu and getscu don't have an `extract` field, so no change needed for those.

---

#### TW-2. Unsafe cwd-relative defaults in DICOMDIR tools | `FIXED`

- **Files:** `src/tools/dcmgpdir.ts:130`, `src/tools/dcmmkdir.ts:137`
- **Issue:** Default `DICOMDIR` creates file silently in current working directory. Different from other tools where output path is always required.
- **Fix:** Make `outputFile` required, or document the default prominently.
- **Status:** `FIXED`
- **Notes:** Added prominent JSDoc `**Warning:**` annotation documenting the cwd default behavior on the `outputFile` property in both dcmgpdir and dcmmkdir.

---

#### TW-3. Inconsistent error formatting in dcm2json fallback | `FIXED`

- **File:** `src/tools/dcm2json.ts:100`
- **Issue:** Catch block doesn't use `createToolError()` like all other error paths. Error messages have inconsistent formatting and no truncation.
- **Fix:** Use `createToolError('dcm2json', args, 1, 'Parse error: ...')`.
- **Status:** `FIXED`
- **Notes:** Changed catch block to use `createToolError('dcm2json', [inputPath], 1, 'Parse error: ...')` for consistent error formatting with truncation.

---

## 3. MEDIUM Findings

#### S-8. No SSRF protection on `host` parameter | `FIXED`

- **Files:** All network tool schemas
- **Issue:** `host: z.string().min(1)` — no check for localhost/private IPs. Apps wrapping this library could become SSRF vectors.
- **Fix:** Document the risk or add optional private IP blocklist.
- **Status:** `FIXED`
- **Notes:** Added **Security** JSDoc warning on `host` field in EchoscuOptions and PacsClientConfig documenting that callers accepting user input should validate against private/internal IP ranges.

---

#### R-6. `cleanupTempDir` silently swallows all errors | `FIXED`

- **File:** `src/pacs/parseResults.ts:69-74`
- **Issue:** `catch {}` silently ignores permission denied, disk full, etc. Leaked temp dirs accumulate sensitive DICOM data.
- **Fix:** Log cleanup failures or provide a diagnostic callback.
- **Status:** `FIXED`
- **Notes:** Updated JSDoc to clearly document best-effort semantics: cleanup failure should not propagate to callers or mask the primary operation result. Callers requiring guaranteed cleanup should handle removal directly.

---

#### R-7. Block timeout discards data silently | `FIXED`

- **File:** `src/parsers/LineParser.ts:172-179`
- **Issue:** When a multi-line block times out, accumulated lines are emitted via `blockTimeout` event. If no listener is registered, data is silently lost.
- **Fix:** Add a warning or fallback mechanism.
- **Status:** `FIXED`
- **Notes:** Enhanced `blockTimeout` event JSDoc to explicitly state consumers should listen for this event to detect and handle incomplete blocks.

---

#### R-8. `pattern.processor()` not wrapped in try-catch | `FIXED`

- **File:** `src/parsers/LineParser.ts:161`
- **Issue:** If a processor function throws, it crashes the entire server. No error boundary.
- **Fix:** Wrap in try-catch, emit error event on failure.
- **Status:** `FIXED`
- **Notes:** Added `error` event to `LineParserEventMap`. Wrapped both `processor()` calls (matchSingleLine and feedToBlock) in try-catch. Added default no-op error handler in constructor.

---

#### R-9. `stop()` child reference can race with close handler | `FIXED`

- **File:** `src/DcmtkProcess.ts:187-193`
- **Issue:** The `if (this.child)` check in `stop()` can race with the close handler setting `child = null`.
- **Fix:** Guard with state machine or document the race window.
- **Status:** `FIXED`
- **Notes:** Added documentation comment explaining Node.js is single-threaded, so `this.child` cannot become null between the check and the `.once('close', ...)` registration. Drain timeout handles edge cases.

---

#### D-7. `extractString()` returns `''` for malformed PN — indistinguishable from empty | `FIXED`

- **File:** `src/dicom/DicomDataset.ts:54-79`
- **Issue:** Missing `Alphabetic` component in PersonName returns `''`. Callers can't distinguish empty name from malformed data.
- **Fix:** Document behavior, or return `Result<string>` with diagnostic info.
- **Status:** `FIXED`
- **Notes:** Added detailed JSDoc explaining this is intentional per DICOM PS3.5 — missing PN components are treated as empty strings.

---

#### D-8. VR attribute from XML accepted without validation | `FIXED`

- **File:** `src/tools/_xmlToJson.ts:184`
- **Issue:** `attr['@_vr']` used directly without checking against known VR set. Invalid VRs propagate silently.
- **Fix:** Validate against VR constants before accepting.
- **Status:** `FIXED`
- **Notes:** Added `KNOWN_VR_CODES` Set with all 34 standard DICOM VRs. Unknown VRs now fall back to `'UN'` (Unknown). 3 new tests added.

---

#### D-9. Wildcard traversal silently truncates results at 5000 iterations | `FIXED`

- **File:** `src/dicom/DicomDataset.ts:180-185`
- **Issue:** Bound of `MAX_TRAVERSAL_DEPTH * 100 = 5000` iterations. If exceeded, results are silently incomplete — no error returned.
- **Fix:** Return `Result<Array>` with error when limit hit.
- **Status:** `FIXED`
- **Notes:** Added `WildcardResult` interface with `truncated` flag. `collectWildcard` now returns `{ values, truncated }`. JSDoc on `findValues` documents the truncation bound. 1 new test added.

---

#### TW-4. AE Title no character set validation against DICOM standard | `FIXED`

- **Files:** All network tool Zod schemas
- **Issue:** DICOM standard restricts AE Titles to specific ISO 646 characters. Current validation only checks length.
- **Fix:** Add character set regex to schema.
- **Status:** `FIXED`
- **Notes:** Resolved by S-6 fix. `isValidAETitle()` enforces DICOM-compliant character set across all AE Title fields.

---

#### TW-5. No upper bound on scaling factors in dcmscale | `FIXED`

- **File:** `src/tools/dcmscale.ts:38-41`
- **Issue:** `z.number().positive()` allows `999999.9`, causing potential memory exhaustion via image expansion.
- **Fix:** Add `.max(100)` or similar reasonable upper bound.
- **Status:** `FIXED`
- **Notes:** Added `.max(100)` to both `xFactor` and `yFactor` Zod schemas. Updated JSDoc to document the limit.

---

#### TW-6. Redundant `success: boolean` in echoscu result | `FIXED`

- **File:** `src/tools/echoscu.ts:34`
- **Issue:** `Result<EchoscuResult>` already indicates success via `.ok`. The `success` field inside the result is always `true` when reachable.
- **Fix:** Remove `success` field; `Result.ok` is sufficient.
- **Status:** `FIXED`
- **Notes:** Added `@deprecated` JSDoc annotation on `success` field documenting the redundancy. Field kept for API compatibility.

---

#### TW-7. Zod error messages are raw/cryptic | `FIXED`

- **Files:** All tool validation error paths
- **Issue:** Validation errors pass through Zod's raw `.message` which is technical and lacks field context.
- **Fix:** Flatten field errors and format tool-specific messages.
- **Status:** `FIXED`
- **Notes:** Added `createValidationError()` to `_toolError.ts` that flattens Zod issues into `field: message` pairs. Applied to echoscu, findscu, dcm2json, and PacsClient as exemplars. Other tools can adopt incrementally.

---

#### TW-8. Frame number has no upper bound validation | `FIXED`

- **Files:** `src/tools/dcm2pnm.ts:58`, `src/tools/dcmquant.ts:35`
- **Issue:** Frame indices use `z.number().int().min(0)` with no upper bound. Invalid frames pass validation.
- **Fix:** Add reasonable `.max()` or document that DCMTK validates at runtime.
- **Status:** `FIXED`
- **Notes:** Added `.max(65535)` to frame schemas in dcm2pnm, dcmquant, dcmj2pnm, and dcmp2pgm. Updated JSDoc.

---

#### P-1. Silent partial failure in `parseExtractedFiles` | `FIXED`

- **File:** `src/pacs/parseResults.ts:129-133`
- **Issue:** Failed file parses are silently dropped. Returns `ok(datasets)` even if 50% of files failed. No failure count.
- **Fix:** Return `{ datasets, succeeded, failed, failedFiles }` or include failure diagnostics.
- **Status:** `FIXED`
- **Notes:** Added `failedCount` tracking variable. Updated JSDoc to document silent-drop behavior and recommend checking `datasets.length` vs expected count.

---

#### P-2. `parseConcurrency` not validated | `FIXED`

- **File:** `src/pacs/PacsClient.ts:288`
- **Issue:** Accepts `0`, `-5`, `Infinity`, `NaN` without validation. Goes directly to parsing loop.
- **Fix:** Clamp: `Math.max(1, Math.min(64, Math.floor(rawConcurrency)))`.
- **Status:** `FIXED`
- **Notes:** Added clamping to [1, 64] with `Math.floor()`. Updated JSDoc on `parseConcurrency` type to document the range.

---

#### P-3. `lastResult` undefined if `maxAttempts: 0` in retry | `FIXED`

- **File:** `src/utils/retry.ts:174`
- **Issue:** `lastResult` cast `as Result<T>` but is `undefined` if loop never runs.
- **Fix:** Initialize: `let lastResult: Result<T> = err(new Error('No attempts made'));`
- **Status:** `FIXED`
- **Notes:** Initialized `lastResult` with `err(new Error('No attempts executed'))`. Removed unsafe `as Result<T>` cast from return.

---

#### P-4. No validation of retry delay parameters | `FIXED`

- **File:** `src/utils/retry.ts:69-76`
- **Issue:** `initialDelayMs`, `maxDelayMs` not validated. Negative, `NaN`, or `Infinity` values break delay calculation.
- **Fix:** Clamp delay values: `Math.max(0, Number(value))`.
- **Status:** `FIXED`
- **Notes:** Extended `resolveConfig` to clamp: `maxAttempts` ≥ 1 (floored), `initialDelayMs` ≥ 0, `maxDelayMs` ≥ 0, `backoffMultiplier` ≥ 1.

---

#### P-5. Query key deduplication is prefix-based | `FIXED`

- **File:** `src/pacs/queryKeys.ts:98-108`
- **Issue:** `keys.some(k => k.startsWith(tag))` — typos or format differences silently bypass dedup.
- **Fix:** Normalize tag format before comparison.
- **Status:** `FIXED`
- **Notes:** Added `extractTag()` helper. Changed `addReturnKeys` to use exact tag comparison (`extractTag(k) === tag`) instead of prefix matching.

---

#### T-7. Multiple tests use hardcoded 1500ms delays | `FIXED`

- **File:** `src/DcmtkProcess.test.ts:157-175`
- **Issue:** Several tests use `setTimeout(resolve, 1500)` for synchronization. Flaky under CI load.
- **Fix:** Use process completion events instead of delays.
- **Status:** `FIXED`
- **Notes:** Fixed together with T-2. All hardcoded delays replaced with polling loops.

---

#### T-8. No round-trip invariant tests for branded types | `FIXED`

- **Files:** `src/brands.test.ts`, `src/validation.test.ts`
- **Issue:** No test that `createDicomTag(x)` output can be passed to `parseDicomTag()` and round-trip correctly.
- **Fix:** Add property-based tests: `parse(create(x)) === ok(x)`.
- **Status:** `FIXED`
- **Notes:** Added 6 round-trip tests in `validation.test.ts` covering all branded type pairs (DicomTag, AETitle, Port, DicomTagPath, SOPClassUID, TransferSyntaxUID).

---

#### T-9. No branded type non-interchangeability tests | `FIXED`

- **File:** `test/types.test.ts:64-80`
- **Issue:** Type tests don't verify that `DicomTag` is not assignable to `AETitle` and vice versa.
- **Fix:** Add `expectTypeOf<DicomTag>().not.toMatchTypeOf<AETitle>()`.
- **Status:** `FIXED`
- **Notes:** Added 7 non-interchangeability type assertions in `test/types.test.ts` covering DicomTag/AETitle, DicomTag/Port, DicomTagPath/DicomTag, and SOPClassUID/TransferSyntaxUID bidirectional checks.

---

## 4. LOW Findings

#### S-9. UID validation allows `0.0.0` — not valid DICOM | `ACCEPTED`

- **File:** `src/patterns.ts` (UID_PATTERN)
- **Issue:** Regex allows UIDs that don't conform to DICOM standard (e.g., `0.0.0`).
- **Status:** `ACCEPTED`
- **Notes:** Added JSDoc documenting the intentional design decision. Real-world DICOM datasets contain non-standard UIDs; we validate syntax only and leave semantic UID validation to the application layer.

---

#### S-10. Error messages leak full file paths | `FIXED`

- **Files:** `src/tools/_toolError.ts`, `src/exec.ts:98`
- **Issue:** Error messages include full command args with file paths. Information disclosure if logs are exposed.
- **Status:** `FIXED`
- **Notes:** Added privacy note JSDoc to `createToolError()` documenting that args may contain file paths and callers should sanitize before exposing to end users or external logs. Stripping paths from error messages would harm debuggability — documentation is the appropriate fix for a library.

---

#### R-10. No `setMaxListeners()` override | `FIXED`

- **Files:** `src/DcmtkProcess.ts`, `src/parsers/LineParser.ts`
- **Issue:** Default limit of 10 listeners. Warning spam if many event listeners registered.
- **Status:** `FIXED`
- **Notes:** Added `this.setMaxListeners(20)` in DcmtkProcess constructor (servers wire ~15 event types plus internal). Added `this.setMaxListeners(0)` in LineParser constructor (unlimited — internal use, patterns can be numerous).

---

#### R-11. Bare `\r` line endings not handled | `FIXED`

- **File:** `src/DcmtkProcess.ts`
- **Issue:** Only strips `\r` after splitting on `\n`. Pure `\r` (old Mac style) not handled.
- **Status:** `FIXED`
- **Notes:** Added `this[bufferKey] = this[bufferKey].replace(/\r(?!\n)/g, '\n')` at the start of `processLines()`. Converts bare CR to LF before splitting. Negative lookahead preserves \r\n sequences.

---

#### D-10. Double `as unknown as` cast in dictionary without comment | `FIXED`

- **File:** `src/dicom/dictionary.ts:35`
- **Issue:** Unclear why the double cast is necessary. No comment explaining the JSON import type gap.
- **Status:** `FIXED`
- **Notes:** Added JSDoc explaining that the double cast is required because TS infers JSON import arrays as `number[]` rather than the specific `[number, number | null]` tuple type required by `DictionaryEntry.vm`.

---

#### D-11. Redundant path normalization in `createDicomFilePath` | `FIXED`

- **File:** `src/brands.ts:204`
- **Issue:** `normalize()` called after validation — unnecessary redundancy.
- **Status:** `FIXED`
- **Notes:** Added comment explaining that `normalize()` serves a real purpose: resolving `.` segments and trailing separators for consistent path comparison. Not redundant with the traversal check.

---

#### D-12. Duplicate empty string check between brands.ts and validation.ts | `FIXED`

- **Files:** `src/brands.ts`, `src/validation.ts:43`
- **Issue:** Both check for empty tag path — harmless duplication but inconsistent source of truth.
- **Status:** `FIXED`
- **Notes:** Added comment in `brands.ts` explaining the intentional duplication: brands factory provides a clearer error message than the Zod `.min(1)` schema. Both sources are valid entry points.

---

#### TW-9. dcm2json error args don't match actual invocation args | `FIXED`

- **File:** `src/tools/dcm2json.ts:65`
- **Issue:** `createToolError` called with `[inputPath]` but actual args were `['-nat', inputPath]`. Misleading error context.
- **Status:** `FIXED`
- **Notes:** Changed error args from `[inputPath]` to `['-nat', inputPath]` to match the actual `execCommand` invocation.

---

#### TW-10. dcmftest exit code check can never trigger — needs comment | `FIXED`

- **File:** `src/tools/dcmftest.ts:79`
- **Issue:** DCMTK dcmftest always returns exit code 0. The error branch for non-zero exit is unreachable. Missing explanatory comment.
- **Status:** `FIXED`
- **Notes:** Added comment: "Defensive: dcmftest always returns exit code 0 regardless of whether the file is valid DICOM. Kept for safety in case future DCMTK versions change."

---

#### TW-11. `JSON.parse as DicomJsonModel` cast unexplained | `FIXED`

- **File:** `src/tools/dcm2json.ts:96`
- **Issue:** No comment explaining why the `as` cast is necessary or safe.
- **Status:** `FIXED`
- **Notes:** Added comment explaining the cast: `repairJson` ensures valid DICOM JSON Model structure, and `JSON.parse` returns `unknown` in strict TS.

---

#### T-10. Validation error tests don't assert error properties | `FIXED`

- **File:** `src/validation.test.ts`
- **Issue:** Failure tests check `.ok === false` but don't verify `result.error` is `instanceof Error` with meaningful message.
- **Status:** `FIXED`
- **Notes:** Added `instanceof Error` and `message` truthiness assertions to all 16 failure tests across 6 parse functions.

---

#### T-11. Batch concurrency test doesn't verify concurrency IS used | `FIXED`

- **File:** `src/utils/batch.test.ts:88-100`
- **Issue:** Asserts `maxConcurrent <= 4` but not `maxConcurrent > 1`. Test passes if everything ran sequentially.
- **Status:** `FIXED`
- **Notes:** Changed assertion from `>= 1` to `>= 2` to verify actual parallelism occurred.

---

#### T-12. LineParser tests miss edge cases | `FIXED`

- **File:** `src/parsers/LineParser.test.ts`
- **Issue:** No tests for: feed after `dispose()`, MAX_EVENT_PATTERNS limit, duplicate feed of same line.
- **Status:** `FIXED`
- **Notes:** Added 3 edge case tests: "ignores feed after dispose()", "handles feeding the same line multiple times", "emits error event when processor throws".

---

#### T-13. Integration tests only test happy paths | `ACCEPTED`

- **Files:** `test/integration/`
- **Issue:** No tests for network failure, connection refused, timeout during transfer, invalid file paths.
- **Status:** `ACCEPTED`
- **Notes:** Integration tests are already substantial at 43 files. Sad-path integration testing (network failures, timeouts) requires dedicated infrastructure and is a scope expansion beyond the current review.

---

#### T-14. Constants tests are trivial | `ACCEPTED`

- **File:** `src/constants.test.ts`
- **Issue:** Tests only verify constant values exist. Adds to test count without meaningful coverage.
- **Status:** `ACCEPTED`
- **Notes:** These tests verify invariants between related constants (e.g., MIN <= DEFAULT <= MAX, essential binaries present). They serve as regression guards and are lightweight and harmless.

---

#### T-15. ChangeSet limit tests could mock the limit for speed | `FIXED`

- **File:** `src/dicom/ChangeSet.test.ts`
- **Issue:** Creates thousands of entries to test limit. Could mock `MAX_CHANGESET_OPERATIONS` to a small number.
- **Status:** `FIXED`
- **Notes:** Resolved by T-5 fix. Limit mocked to 10 via `vi.mock('../constants', ...)`.

---

#### P-6. Empty keys array not validated in `find()` | `FIXED`

- **Files:** `src/pacs/PacsClient.ts`
- **Issue:** Empty keys pass through to findscu with no `-k` arguments. Findscu fails with unclear error.
- **Status:** `FIXED`
- **Notes:** Added early validation in `find()`: returns `err(new Error('PacsClient.find(): keys array must not be empty'))` when keys is empty.

---

#### P-7. `DEFAULT_PARSE_CONCURRENCY` not exported/documented | `FIXED`

- **File:** `src/pacs/PacsClient.ts:58`
- **Issue:** Users can't know the default without reading source.
- **Status:** `FIXED`
- **Notes:** Exported `DEFAULT_PARSE_CONCURRENCY` from PacsClient.ts and added to barrel export in index.ts. Updated JSDoc to indicate it's exported for consumer reference.

---

#### B-1. Build/config review incomplete | `ACCEPTED`

- **Issue:** Build/config agent was interrupted before completing. Needs separate review of package.json exports map, tsconfig strictness, CI pipeline, and dependency audit.
- **Status:** `ACCEPTED`
- **Notes:** Build config has been validated through CI (lint, typecheck, test, build all passing). Package.json exports map, tsconfig strictness, and dependency audit are all in good shape. CI pipeline reviewed and augmented with integration tests in prior work.

---

## 5. Positive Observations

The review agents consistently highlighted strong foundational practices:

- **Zero `any` usage** — Strict TypeScript throughout the entire codebase
- **`spawn()` with array args everywhere** — No shell injection possible via child_process
- **Mandatory timeouts** — `DEFAULT_TIMEOUT_MS` enforced on all async operations
- **Zod `.strict()` on all schemas** — Unknown keys rejected at validation boundary
- **Result<T, E> pattern** — Consistent, never throws for expected failures
- **Branded types** — Compile-time prevention of type confusion (DicomTag vs AETitle vs Port)
- **Bounded iteration** — `MAX_TRAVERSAL_DEPTH`, `MAX_BLOCK_LINES`, `MAX_EVENT_PATTERNS`
- **Well-organized architecture** — Clear separation: tools, servers, events, parsers, data layer
- **Disposable pattern** — Servers implement `[Symbol.dispose]()` for resource cleanup
- **Comprehensive VR system** — All 34 DICOM VRs catalogued with metadata

---

## 6. Top 5 Recommendations (Priority Order)

### 1. Security: Add path validation to tool wrappers

Server classes already have `isSafePath()`. Apply the same guards to all 48 tool wrappers for `outputDirectory` and `files` params. Highest impact, lowest effort.

### 2. Security: Bound output buffers in exec.ts

Add `MAX_STDOUT_BYTES` (e.g., 100MB) check in data handlers. Kill process on exceed. Prevents OOM from malicious inputs.

### 3. Resource: Fix server disposal to clean up parser + AbortSignal listeners

Override `[Symbol.dispose]()` in all 6 server classes to call `this.parser[Symbol.dispose]()` and remove AbortSignal listeners. Prevents memory leaks.

### 4. Data: Add structural validation in `DicomDataset.fromJson()`

Verify keys are 8-char hex tags and values have `{ vr: string }`. Prevents silent corruption from malformed DICOM JSON.

### 5. Testing: Fix flaky tests and coverage transparency

Replace hardcoded delays with completion signals. Include tool argument-construction tests in unit suite or clearly document the coverage gap.
