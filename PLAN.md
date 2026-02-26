# dcmtk.js — Build Plan (Completed)

A modern, mission-critical TypeScript library wrapping all 60+ DCMTK command-line binaries with type-safe APIs. Built to the standards defined in `docs/TypeScript Coding Standard for Mission-Critical Systems.md`.

## Phase Summary

| Phase | Description                                                                                      | Status      |
| ----- | ------------------------------------------------------------------------------------------------ | ----------- |
| 1     | Modern Library Scaffold (TypeScript, tsup, Vitest, ESLint 9, Prettier, Husky)                    | Complete    |
| 2     | Core Infrastructure (Result, branded types, exec/spawn, findDcmtkPath, validation)               | Complete    |
| 3     | Short-Lived Tool Wrappers (51 async functions across 7 categories)                               | Complete    |
| 4     | Long-Lived Server Classes (6 servers: Dcmrecv, StoreSCP, DcmprsCP, Dcmpsrcv, DcmQRSCP, Wlmscpfs) | Complete    |
| 5     | DICOM Data Layer (DicomDataset, ChangeSet, DicomFile, dictionary, VR, tag paths)                 | Complete    |
| 6     | High-Level APIs (PacsClient with Echo, Query, Retrieve, Store)                                   | Complete    |
| 7     | Utilities (batch processing, retry with backoff)                                                 | Complete    |
| 8.1   | Fuzz Testing (fast-check property-based tests)                                                   | Complete    |
| 8.2   | Type Tests (vitest expectTypeOf assertions)                                                      | Complete    |
| 8.3   | Error Normalization (stderr-lib integration)                                                     | Complete    |
| 8.4   | Debug Logging                                                                                    | Not planned |
| 8.5   | CI/CD Pipeline                                                                                   | Complete    |
| 8.6   | Security Hardening                                                                               | Complete    |

## Deferred Items

- **Phase 8.4 — Debug Logging:** Originally planned for structured debug output via a debug library. Not planned — consumers can inspect stderr from Result errors and server events directly.
- **Phase 8.5 — npm Provenance:** Originally planned for `--provenance` flag in CI publish step. Not planned — can be added later when publishing workflow is set up.

## Key Design Decisions

1. **Result pattern universally.** All functions that can fail return `Result<T, E>`. `throw` reserved for true panics (OOM, assertion failure). This is Rule 6.1/6.2 and the single most important architectural decision.

2. **Branded types for domain primitives.** `DicomTag`, `AETitle`, `Port`, `DicomTagPath`, `SOPClassUID` — not raw strings/numbers. Compile-time prevention of argument mixups. Rule 7.3.

3. **Immutable DicomDataset + explicit ChangeSet.** Data representation is frozen. Mutations are tracked separately and applied explicitly via dcmodify. This eliminates hidden state changes and makes the modification pipeline transparent. Rule 7.1.

4. **Vitest over Jest.** Native TypeScript support without ts-jest transform overhead. ESM-first. Faster execution. Compatible with the same test patterns.

5. **Functions for tools, classes for servers.** Short-lived DCMTK binaries have no state to manage — a function is the right abstraction. Long-lived servers have lifecycle state (running, stopping, pending work) — a class with Disposable interface is appropriate.

6. **`spawn` for dcmodify, `exec` for most others.** dcmodify accepts user-supplied DICOM values that may contain shell-special characters. `spawn` avoids shell injection. Rule 7.4.

7. **Two-phase dcm2json.** Direct dcm2json output has known malformation issues. dcm2xml → parse XML is more reliable, with direct dcm2json as fallback.

8. **No traditional enums.** `as const` objects + derived union types throughout. Rule 3.5, enforced by `erasableSyntaxOnly: true`.

9. **No recursion.** All tree/sequence traversal is iterative with bounded loops. Rules 8.1, 8.2.

10. **Mandatory timeouts on all async ops.** AbortController-based cancellation. No operation can hang indefinitely. Rule 4.2.

11. **Zod at boundaries, branded types internally.** External input (user options, raw JSON from dcm2json, file paths) validated via Zod at module boundaries. Internal code trusts branded types — no re-validation. Rule 7.2.

12. **95% coverage from day one.** Not "raise later" — the vitest config enforces 95% branch/function/line/statement coverage immediately. Rule 9.1.

13. **All 60+ DCMTK tools.** Every binary gets a wrapper. Prioritized P0/P1/P2 but all are planned. No tool left behind.

14. **stderr-lib for error normalization.** Consistent with the broader ecosystem (d-dart uses it). Provides cause chains, metadata, and safe serialization at every catch boundary.

15. **Node.js >= 20.** Per the coding standard's requirement for Node.js 20+. Enables native AbortController, Disposable patterns, and modern V8 features.
