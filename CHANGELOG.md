# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.13.0] - 2026-03-26

### Added

- **`charsetFallback` option** on `DicomOpenOptions`, `Dcm2jsonOptions` — when UTF-8 conversion fails due to illegal byte sequences (broken `SpecificCharacterSet`), automatically retries dcm2xml with `+Ca <fallback>`. `'Latin1'` is recommended — it maps every byte 0x00-0xFF to a valid character, so conversion never fails (#24)
- **`instanceOpenOptions` on `DicomReceiverOptions`** — pass-through configuration for `DicomInstance.open()` calls made internally by DicomReceiver. Covers `charsetAssume`, `charsetFallback`, `timeoutMs`, and `signal` (#24)
- **DicomReceiver defaults `charsetFallback: 'Latin1'`** — files with broken charset encoding are no longer dropped. Characters that can't be converted to UTF-8 are transliterated via Latin-1 fallback instead of causing a fatal error

## [0.12.1] - 2026-03-25

### Fixed

- **Root cause of 30s timeout on DX files** — `fast-xml-parser`'s default entity expansion limit (1000) rejected DICOM files with >1000 XML tags. This caused the fast XML primary path to fail silently, falling through to the `dcm2json` binary which hangs indefinitely on compressed pixel data (DCMTK bug). Set `processEntities: false` since DICOM XML does not use XML entities. Files that previously timed out at 30s now parse in ~200ms (#23)

## [0.12.0] - 2026-03-25

### Added

- **`INSTANCE_ERROR` event** — specific event when `DicomInstance.open()` fails, with `thrown: boolean` to distinguish Result errors from thrown exceptions and full file/association context. Replaces the generic `'error'` event for parse failures (#23)
- **`ASSOCIATION_FINALIZED` event** — fires after ALL work completes (file moves + instance parsing). Includes `instancesReceived` and `instanceErrors` counts. `ASSOCIATION_COMPLETE` still fires after file moves only (#23)
- **`onInstanceError()` convenience method** — registers a listener for `INSTANCE_ERROR` events
- **`onAssociationFinalized()` convenience method** — registers a listener for `ASSOCIATION_FINALIZED` events
- **Instance parsing tracked via `Worker.trackInstance()`** — Set-based auto-cleanup, drained before `ASSOCIATION_FINALIZED` emits

### Fixed

- **Missing `.catch()` on `emitInstanceReceived`** — `DicomInstance.open().then()` had no `.catch()`, causing thrown exceptions to silently reject. Confirmed as the production failure point for missing `INSTANCE_RECEIVED` events (#23)

## [0.11.0] - 2026-03-24

### Breaking Changes

- **DicomReceiver event model split into three stages** — the single `FILE_RECEIVED` event that carried a `DicomInstance` has been replaced with a three-stage pipeline (#23):
    - **`FILE_RECEIVED`** — fires immediately when dcmrecv stores a file (before move/parse). Data: `ReceiverFileReceivedData` (`filePath`, `associationId`, `callingAE`, `calledAE`, `source`)
    - **`FILE_STORED`** — fires after the file is moved to the association directory and stat'd. Data: `ReceiverFileStoredData` (`filePath`, `fileSize`, `associationId`, `associationDir`, `callingAE`, `calledAE`, `source`). **This event always fires if dcmrecv stored the file — no file is ever silently lost.**
    - **`INSTANCE_RECEIVED`** — fires after `DicomInstance.open()` succeeds. Data: `ReceiverInstanceData` (same as `FILE_STORED` plus `instance: DicomInstance`). This event is fire-and-forget and does NOT block `FILE_STORED` or `ASSOCIATION_COMPLETE`. If parsing times out or fails, `FILE_STORED` already fired.
- **`ReceiverFileData` is deprecated** — use `ReceiverFileStoredData` instead. The old type is re-exported as an alias for backward compatibility.
- **Consumers listening for `FILE_RECEIVED` to get `DicomInstance`** must switch to `INSTANCE_RECEIVED`:

    ```typescript
    // Before (0.10.x):
    receiver.onFileReceived(data => {
        console.log(data.instance.patientName);
    });

    // After (0.11.0):
    receiver.onInstanceReceived(data => {
        console.log(data.instance.patientName);
    });

    // Or use FILE_STORED for file-on-disk without waiting for parsing:
    receiver.onFileStored(data => {
        console.log(data.filePath, data.fileSize);
    });
    ```

### Added

- **`onFileStored()` convenience method** — registers a listener for `FILE_STORED` events
- **`onInstanceReceived()` convenience method** — registers a listener for `INSTANCE_RECEIVED` events
- **`ReceiverFileReceivedData`**, **`ReceiverFileStoredData`**, **`ReceiverInstanceData`** types exported
- **Better exec error messages** — timeout/error messages now include the binary name and PID (e.g., `dcm2xml timed out after 30000ms (pid: 12345)`)

### Fixed

- **DicomInstance.open timeout no longer blocks file delivery** — `INSTANCE_RECEIVED` (parsing) is fire-and-forget; `FILE_STORED` fires immediately after the file is on disk. A 30s parse timeout no longer prevents the application from seeing the file (#23)

## [0.10.0] - 2026-03-24

### Changed

- **DicomReceiver internals rewritten** — same public API, clean internals (#23):
    - **Worker class** replaces mutable `WorkerInfo` interface — encapsulated state with proper getters and lifecycle methods
    - **Immutable AssociationContext** — frozen context object created once per connection, passed to all handlers. Eliminates race conditions from reading stale mutable worker state in async handlers
    - **Set-based pending file tracking** — promises auto-remove via `.finally()`, replacing the fragile array approach that caused infinite loops and stale references
    - **Synchronous context capture** in event listeners — association context read before any async work
    - **Error swallower removed** — consumers must register an `'error'` listener. Unhandled errors now surface immediately instead of being silently eaten
    - **Extracted filesystem utilities** to `src/utils/fs.ts` — `ensureDirectory`, `moveFile`, `statFileSafe`, `removeDirSafe` are now shared
    - **Replaced hand-rolled `delay()`** with `import { setTimeout as delay } from 'node:timers/promises'`

### Added

- **`src/utils/fs.ts`** — shared filesystem utilities: `ensureDirectory`, `moveFile`, `statFileSafe`, `removeDirSafe`

### Fixed

- **DicomReceiver infinite while loop** — `finalizeAssociation` used a `while (pendingFiles.length > 0)` loop that never terminated because promises were never removed from the array, starving the Node.js event loop with infinite microtasks (#23)
- **DicomReceiver silent file loss** — error events from `handleFileReceived` were swallowed by a default `this.on('error', () => {})` handler, making file processing failures invisible to consumers (#23)

## [0.9.1] - 2026-03-24

### Changed

- **DicomReceiver `filenameMode` defaults to `'unique'`** — dcmrecv's default mode (`'default'`) names files by SOP Instance UID, which causes silent data loss when a remote SCU sends duplicate SOP Instance UIDs within a single association. The second store overwrites the first file on disk while concurrent `handleFileReceived` handlers race on the same path, causing files that dcmrecv successfully received to never be delivered to the application. The `'unique'` mode generates a fresh UID-based filename for every C-STORE, eliminating the overwrite race without modifying any DICOM data. **It is strongly recommended to keep this default.** (#23)

### Added

- **`fileSize` on `FILE_RECEIVED` event** — `ReceiverFileData` now includes `fileSize: number` (bytes), available without a separate `stat` call
- **`DicomHammer` load testing tool** — generates N copies of a template DICOM file with unique UIDs and sends them to a target SCP with configurable concurrency; reports throughput (files/sec, bytes/sec) (#22)
- **`charsetAssume` option** — exposed on `dcm2xml`, `dcm2json`, and `DicomInstance.open()` for files missing SpecificCharacterSet (maps to dcm2xml `+Ca` flag) (#20)

### Fixed

- **dcm2json compressed pixel data** — fallback direct path now uses `+b +bd <tmpdir>` to redirect bulk data to a temp directory, preventing exit code 81 failures on compressed DICOM files and "Unable to create bulk data file" errors in read-only containers (#21)
- **fast-xml-parser** updated 5.4.1 → 5.5.8 (CVE-2026-26278)

## [0.8.0] - 2026-03-13

### Added

- **`DicomSend` class** — high-throughput DICOM sender wrapping `dcmsend` binary, with the same queuing, bucketing, backpressure, and retry system as `DicomSender`. `dcmsend` automatically proposes each file's native transfer syntax, avoiding codec license requirements when sending compressed data (e.g., JPEG 2000)
- **`SenderEngine<TParams>`** — internal generic engine extracted from `DicomSender`; shared by both `DicomSender` (storescu) and `DicomSend` (dcmsend)
- **dcmsend tool enhancements** — added `noHalt`, `noIllegalProposal`, `decompress`, `multiAssociations`, `createReportFile`, `recurse`, and `scanPattern` options to the `dcmsend` tool wrapper

### Changed

- **`DicomSender` refactored** to delegate to `SenderEngine` — identical external API, reduced code duplication

## [0.7.3] - 2026-03-13

### Added

- **Multiple proposed transfer syntaxes** — `proposedTransferSyntax` now accepts an array of values, enabling storescu to propose multiple transfer syntaxes (e.g., JPEG Lossless + JPEG 2000 + uncompressed) so the SCP can accept whichever matches the file (#19)
- **11 new transfer syntax constants** — `ProposedTransferSyntax` now includes MPEG2, MPEG2_HIGH, MPEG4, MPEG4_BD, MPEG4_2_2D, MPEG4_2_3D, MPEG4_2_ST, HEVC, HEVC10, RLE, and DEFLATED (22 total)
- **`combineProposedTransferSyntaxes` option** — maps to storescu's `+C`/`--combine` flag to combine proposed transfer syntaxes into fewer presentation contexts
- **Per-send `proposedTransferSyntax` and `combineProposedTransferSyntaxes` overrides** on `SendOptions` for DicomSender

## [0.7.2] - 2026-03-12

### Fixed

- **storescu DIMSE failure detection** — `storescu` can exit with code 0 even when DIMSE-level send operations fail (e.g., transfer syntax conversion errors); the wrapper now detects `E: Store Failed` and `E: DIMSE Failed` patterns in stderr and returns `err()` instead of `ok()` (#17)

### Added

- **`required` option on storescu, DicomSender, and SendOptions** — maps to storescu's `-R`/`--required` flag, which proposes only each file's native transfer syntax; prevents transfer syntax negotiation mismatches that cause DIMSE failures with compressed files (#18)

## [0.7.1] - 2026-03-12

### Fixed

- **Remove `noUidChecks` from storescu and DicomSender** — `--no-uid-checks` is a `dcmsend`-only flag; `storescu` does not support it and rejects it with "Unknown option", causing 100% send failure when `noUidChecks: true` was set (#16)

### Added

- **CLI Flag Verification rule** in CLAUDE.md — all CLI flags must be verified against `<binary> --help` before adding to a wrapper; integration tests must confirm every passthrough option

## [0.7.0] - 2026-03-10

### Added

- **DicomReceiver passthrough options** — `filenameExtension`, `filenameMode`, and `storageMode` are now exposed on `DicomReceiverOptions` and forwarded to Dcmrecv workers; allows controlling received file naming (e.g., `.dcm` extension) and storage behavior (#14)
- **DicomSender passthrough options** — `maxPduReceive`, `maxPduSend`, `associationTimeout`, `acseTimeout`, `dimseTimeout`, `noHostnameLookup`, and `verbosity` are now exposed on `DicomSenderOptions` and forwarded to storescu (#15)
- **stdout/stderr in SendResult** — `SendResult`, `SenderSendCompleteData`, and `SenderSendFailedData` now include `stdout` and `stderr` from the storescu call (#15)
- **Per-send AE Title overrides** — `SendOptions` now accepts `calledAETitle` and `callingAETitle` to override the instance defaults on a per-send basis (#15)
- `StorescuResult` now includes `stdout` field alongside `stderr`

## [0.6.5] - 2026-03-09

### Fixed

- **dcmodify sequence path validation** — reverted v0.6.4 regex relaxation; dcmodify CLI requires explicit `[N]` array indices before every dot separator in sequence paths (e.g., `(0008,1111)[0].(0008,0013)` not `(0008,1111).(0008,0013)`); the original validation was correct and now catches invalid paths early instead of deferring to a cryptic dcmodify CLI error (#13)

## [0.6.4] - 2026-03-09 [YANKED]

### Fixed (reverted in 0.6.5)

- ~~dcmodify sequence path validation relaxed to accept paths without array indices~~ — incorrect; dcmodify CLI requires explicit `[N]` indices (#12, reverted by #13)

## [0.6.3] - 2026-03-06

### Fixed

- **DicomReceiver FILE_RECEIVED race condition** — `ASSOCIATION_COMPLETE` now awaits all pending `handleFileReceived` operations before emitting, ensuring `FILE_RECEIVED` events (and their `DicomInstance`) are fully resolved first; previously, `ASSOCIATION_COMPLETE` could fire before files were moved to `storageDir`, causing downstream code that cleaned up the association directory to delete files before `DicomInstance.open()` could read them (#11)

## [0.6.2] - 2026-03-06

### Fixed

- **DicomReceiver AE title rejection** — removed hardcoded `'DCMRECV'` default for worker `aeTitle`; when no `aeTitle` is specified, dcmrecv now uses `--use-called-aetitle` (accept any called AE) instead of `--aetitle DCMRECV` which enabled strict checking and rejected senders using the default called AE (`ANY-SCP`) (#10)
- Fixed DicomReceiver integration tests to pass `calledAETitle` matching the worker AE title

## [0.6.1] - 2026-03-06

### Fixed

- **DicomReceiver TCP proxy hang** — defer `pipe()` until worker socket `connect` event fires; pre-connection writes were silently lost on Windows and Docker/Alpine, causing DICOM association negotiation to hang indefinitely (#10)
- Re-enabled DicomReceiver integration tests in CI (previously skipped due to this bug)

## [0.6.0] - 2026-03-05

### Added

- **`walkTags(data, options?)`** — utility for iterating all DICOM tags in a JSON Model dataset with VR filtering and bounded sequence recursion (#8)
- `DicomDataset.walkTags(options?)` — instance method delegating to the standalone function
- Exported types: `WalkTagEntry`, `WalkTagsOptions`

### Fixed

- **Numeric VR coercion** — `DS`, `FL`, `FD`, `IS`, `SL`, `SS`, `SV`, `UL`, `US`, `UV` values are now JSON numbers per DICOM PS3.18 F.2.3, not strings (#9)
- **`@_number` unwrapping** — fast-xml-parser attribute wrapper objects (`{"@_number": "1"}`) are now unwrapped to plain values (#7)

### Breaking

- `Value` arrays for numeric VRs (`DS`, `IS`, `US`, `UL`, etc.) now contain `number` instead of `string`. Code doing `typeof value === 'string'` on these VRs will need updating. `DicomDataset.getNumber()` is unaffected.

## [0.5.0] - 2026-03-05

### Added

- **`handleSocket(socket)`** on `DicomReceiver` — route external `net.Socket` connections directly to idle workers, enabling protocol routers and custom TCP listeners
- **`port: 0` mode** — skip the built-in TCP proxy entirely when using `handleSocket()` exclusively
- **Event bubbling** — 4 new events on `DicomReceiver`, bubbled from Dcmrecv workers:
    - `ASSOCIATION_RECEIVED` — `{ associationId, callingAE, calledAE, source }`
    - `C_STORE_REQUEST` — `{ associationId, raw }` (per-file progress tracking)
    - `ECHO_REQUEST` — `{ associationId }` (monitoring)
    - `REFUSING_ASSOCIATION` — `{ reason }`
- **Passthrough options** on `DicomReceiver`: `acseTimeout`, `dimseTimeout`, `maxPdu` — forwarded to all Dcmrecv workers
- **Output capture** — `ASSOCIATION_COMPLETE` events now include `output: readonly string[]` with captured worker stdout/stderr lines (bounded at 500 per association)
- Convenience methods: `onAssociationReceived()`, `onCStoreRequest()`, `onEchoRequest()`, `onRefusingAssociation()`
- 4 new exported types: `PoolAssociationReceivedData`, `PoolCStoreRequestData`, `PoolEchoRequestData`, `PoolRefusingAssociationData`
- 31 new unit tests for DicomReceiver (1813 total across 100 test files)

### Changed

- `DicomReceiverOptions.port` now accepts `0` (previously required `>= 1`)
- Extracted `createDcmrecv()` helper to keep `spawnWorker()` within 40-line limit

## [0.4.0] - 2026-03-02

### Added

- **Verbosity control** on all 51 tool wrappers — `verbosity?: 'verbose' | 'debug'` maps to `-v`/`-d` flags for diagnostic output
- **Network resilience flags** on all 7 network tools (echoscu, storescu, findscu, movescu, getscu, termscu, dcmsend):
    - `maxPduReceive` / `maxPduSend` — PDU size control (`--max-pdu`, `--max-send-pdu`)
    - `associationTimeout` / `acseTimeout` / `dimseTimeout` — granular timeout control (`-to`, `-ta`, `-td`)
    - `noHostnameLookup` — DNS bypass for containerized environments (`-nh`)
- `storescu`: `noUidChecks` flag (`--no-uid-checks`) for files with non-standard UIDs
- `dcmcjpeg`: `progressive` flag (`+p`) for progressive JPEG compression
- `dcm2pnm`: feature parity with dcmj2pnm — `png16` format (`+on2`), `windowCenter`/`windowWidth` (`+Wl`), `dcm2img` binary fallback
- `dcmj2pnm`: 16-bit PNG format (`+on2`), `windowCenter`/`windowWidth` (`+Wl`), `dcm2img` binary fallback
- `dcmsend`: `acseTimeout`, `dimseTimeout`, stdout capture in result
- `dsrdump` / `dsr2xml`: `charsetAssume` option (`+Ca`) for SR files without Specific Character Set
- `typesVersions` in package.json for classic `moduleResolution: "Node"` compatibility
- 46 new tool wrapper test files (581 new tests, 1793 total across 100 test files)

### Changed

- `dcmsend`: migrated `verbose?: boolean` to `verbosity?: 'verbose' | 'debug'` (breaking for dcmsend users who passed `verbose: true`)
- Extracted `pushNetworkArgs` helpers in network tools and `pushDisplayArgs`/`pushLutArgs` in data tools to keep function complexity within ESLint limits

## [0.3.0] - 2026-03-01

### Added

- `DicomSender` — high-throughput DICOM sender with queuing, backpressure, and three sending modes:
    - `single` — one association at a time, FIFO queue
    - `multiple` — up to N concurrent `storescu` associations
    - `bucket` — accumulates files into buckets, flushed on timeout or max size
- Adaptive backpressure: HEALTHY → DEGRADED → DOWN state machine based on consecutive failures/successes, dynamically adjusts effective concurrency
- Automatic retry with exponential backoff on send failures
- Typed events: `SEND_COMPLETE`, `SEND_FAILED`, `HEALTH_CHANGED`, `BUCKET_FLUSHED`, `ERROR`
- `docs/senders.md` — full DicomSender documentation with usage examples, configuration reference, and backpressure explanation
- Example 08 (`examples/08-receive-modify-send/`) — receive, modify, and forward DICOM files via modality-based routing using DicomReceiver + DicomInstance + DicomSender

### Fixed

- AE Title validation now accepts all printable ASCII characters except backslash, per DICOM PS3.5 default character repertoire (previously only allowed letters, digits, spaces, and hyphens — rejected valid characters like underscore, dot, and special punctuation)

### Changed

- Updated CLAUDE.md with DicomSender architecture and API reference sections
- Updated README.md with DicomSender in server reference table and senders documentation link
- Updated examples/README.md with example 08 entry

## [0.2.0] - 2026-03-01

### Added

- `PoolStatus` named interface exported from DicomReceiver with TSDoc
- ADR-004 documenting DicomFile to DicomInstance rename decision
- Docker image reference in Getting Started and README (`michaelleehobbs/nodejs-dcmtk`)

### Changed

- Updated all dev dependencies to latest majors: ESLint 10, Vitest 4, @types/node 25, lint-staged 16, globals 17
- Fixed EventEmitter emit pattern across all 6 server classes for @types/node 25 compatibility
- Adjusted coverage thresholds for Vitest 4 v8 provider counting changes
- Rewrote CHANGELOG with accurate version history
- Updated README: added DicomReceiver to server table, complete feature list
- Updated GETTING_STARTED: fixed package names, added Docker section, accurate imports
- Fixed CODE_REVIEW_2 stale tool/server counts
- Updated CLAUDE.md with poolStatus documentation

## [0.1.5] - 2026-03-01

### Added

- `DicomReceiver` — pooled DICOM receiver managing multiple `Dcmrecv` workers behind a TCP proxy with auto-scaling between configurable `minPoolSize` and `maxPoolSize`
- `AssociationTracker` built into `Dcmrecv` and `StoreSCP` — automatically correlates received files to associations via `FILE_RECEIVED` and `ASSOCIATION_COMPLETE` events
- `DicomInstance` on `FILE_RECEIVED` events — received files are now wrapped as `DicomInstance` objects for immediate fluent access
- Transfer stats on `ASSOCIATION_COMPLETE` events — duration, file count, and byte totals

### Changed

- Removed `unwrap()` helper — all code now uses explicit `if (!result.ok)` narrowing for Result types
- Standardized validation errors across all 51 tools and 7 servers using `createValidationError()`
- Aligned `DicomReceiver` API with other server classes (`stop()` returns `Promise<void>`, typed `onEvent()` method)
- Updated TSDoc across public APIs

## [0.1.4] - 2026-02-28

### Changed

- Renamed `DicomFile` to `DicomInstance` — unified DICOM object with fluent API for reading, modifying, and writing
- Refactored `DicomInstance` internals: renamed private fields for clarity, improved import structure using barrel imports
- Updated all examples (01-06) to use `DicomInstance` fluent API and `AssociationTracker`

### Fixed

- `StoreSCP` file tracking now correctly correlates files to associations
- Fixed examples 02-06: corrected SR XML format, AE titles, config references, and sample file paths
- Fixed `ChangeSet` example: unwrap `createDicomTagPath` Result before use

## [0.1.3] - 2026-02-25

### Added

- `PacsClient` — high-level PACS client with `echo()`, `findStudies()`, `findSeries()`, `findImages()`, `findWorklist()`, `find()`, `retrieveStudy()`, `retrieveSeries()`, and `store()` methods
- 3 additional tool wrappers (48 to 51): `dcmqridx`, `dcmcjpls`, `dcmdjpls`
- `DicomInstance` integration tests
- 6 runnable example projects demonstrating common DCMTK workflows

### Changed

- Documentation overhaul: tiered docs structure with 12 new child documents
- Integrated `stderr-lib` for error normalization (Phase 8.3)
- Consolidated CI into a single Docker job running `test:all` (unit + integration + coverage)
- Replaced PacsClient mock tests with real integration tests against DcmQRSCP/StoreSCP

### Fixed

- All 67 code review findings resolved (62 fixed, 5 accepted)
- All integration test failures for DCMTK 3.7.0 compatibility
- C-MOVE retrieval no longer passes `outputDirectory` to `movescu`
- `dcmodify` now ignores missing tags on erase operations

## [0.1.2] - 2026-02-15

### Added

- `.gitattributes` to enforce LF line endings

### Changed

- Used Node.js 24 in publish workflow for npm Trusted Publishers (OIDC)

### Fixed

- Coverage thresholds adjusted for expanded test suite

## [0.1.1] - 2026-02-11

### Added

- Alpha preview warning to README

### Changed

- Prepared alpha release infrastructure for `@ubercode/dcmtk` on npm

## [0.1.0] - 2026-02-10

### Added

- Core infrastructure: `Result<T, E>` pattern with `ok()`, `err()`, `mapResult()` helpers — never throw for expected failures
- Branded types: `DicomTag`, `AETitle`, `Port`, `DicomTagPath`, `SOPClassUID`, `TransferSyntaxUID`, `DicomFilePath` with factory functions and Zod validation schemas
- Platform-aware DCMTK binary discovery via `DCMTK_PATH` env var or known install locations
- Process execution layer: `execCommand()` for short-lived tools, `spawnCommand()` for injection-safe modifications
- `DcmtkProcess` base class for long-lived processes (typed EventEmitter, Disposable pattern)
- 48 short-lived tool wrappers covering DCMTK command-line binaries:
    - Data & Metadata: `dcm2xml`, `dcm2json`, `dcmdump`, `dcmconv`, `dcmodify`, `dcmftest`, `dcmgpdir`, `dcmmkdir`
    - File Conversion: `xml2dcm`, `json2dcm`, `dump2dcm`, `img2dcm`, `pdf2dcm`, `dcm2pdf`, `cda2dcm`, `dcm2cda`, `stl2dcm`
    - Compression: `dcmcrle`, `dcmdrle`, `dcmencap`, `dcmdecap`, `dcmcjpeg`, `dcmdjpeg`
    - Image Processing: `dcmj2pnm`, `dcm2pnm`, `dcmscale`, `dcmquant`, `dcmdspfn`, `dcod2lum`, `dconvlum`
    - Network: `echoscu`, `dcmsend`, `storescu`, `findscu`, `movescu`, `getscu`, `termscu`
    - Structured Reports: `dsrdump`, `dsr2xml`, `xml2dsr`, `drtdump`
    - Presentation State & Print: `dcmpsmk`, `dcmpschk`, `dcmprscu`, `dcmpsprt`, `dcmp2pgm`, `dcmmkcrv`, `dcmmklut`
- 6 long-lived server classes with typed EventEmitter APIs:
    - `Dcmrecv` — DICOM receiver (C-STORE SCP)
    - `StoreSCP` — Storage SCP with advanced options
    - `DcmQRSCP` — Query/Retrieve SCP (C-FIND/C-MOVE/C-GET)
    - `Wlmscpfs` — Worklist Management SCP
    - `DcmprsCP` — Print Management SCP
    - `Dcmpsrcv` — Viewer network receiver
- Event system with typed patterns for server output parsing (41 event patterns across 4 server types)
- DICOM data layer:
    - `DicomDataset` — immutable dataset with typed accessors, path traversal, wildcard search, convenience getters
    - `ChangeSet` — immutable builder for tag modifications and erasures
    - `DicomInstance` — unified DICOM object with fluent API (open, modify, write, metadata)
- DICOM metadata infrastructure:
    - 34 standard Value Representations with category metadata
    - 4,902-entry tag dictionary generated from DCMTK sources
    - SOP Class UID to name mappings
    - Tag path parsing and traversal utilities
    - XML-to-JSON conversion for DCMTK output
- Utility functions: `batch()` for parallel processing with concurrency control, `retry()` with exponential backoff
- Full TypeScript with maximum strict configuration, dual CJS/ESM build, complete `.d.ts` declarations
- AbortSignal support for cancellation across all async operations
- Configurable timeouts on all async operations
- 1071 tests across 49 unit/fuzz/edge-case test files with 99%+ statement coverage
- 44 integration test files covering real DCMTK binary interactions
- CI/CD pipeline with lint, typecheck, test, build, and audit stages
- npm publishing via Trusted Publishers (OIDC) under `@ubercode/dcmtk`
