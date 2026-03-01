# ADR-004: Rename DicomFile to DicomInstance

## Status

Accepted

## Context

The original `DicomFile` class was a file I/O facade responsible for opening DICOM files, applying modifications, and writing copies. Its name implied it was solely about file operations, but in practice the class represented a richer concept: a DICOM object composed of an immutable dataset, pending changes, a file path, and application metadata.

The coding standard (Rule 7.1) requires immutability by default, and the existing API did not fully embrace fluent immutable patterns. Additionally, `DicomFile` could not represent in-memory DICOM instances without a backing file, limiting its usefulness for workflows that construct or transform DICOM data without immediately persisting it.

## Decision

Rename `DicomFile` to `DicomInstance` and redesign it as a unified DICOM object with a fluent immutable API.

`DicomInstance` composes four concerns into a single type:

- **DicomDataset** — immutable parsed DICOM data with typed accessors
- **ChangeSet** — immutable builder tracking pending tag modifications and erasures
- **File path** — optional backing file (not required for in-memory instances)
- **Application metadata** — arbitrary key/value pairs for non-DICOM context

Every mutation method (`setPatientName()`, `erasePrivateTags()`, `setTag()`, `setBatch()`, `transformTag()`, `withChanges()`, `withFilePath()`, `withMetadata()`) returns a new `DicomInstance`, leaving the original unchanged.

Two static factories provide construction:

- `DicomInstance.open(path)` — opens and parses a DICOM file from disk
- `DicomInstance.fromDataset(dataset, path?)` — wraps an existing dataset, optionally associating a file path

## Consequences

- **Positive:** The name `DicomInstance` accurately describes the class as a DICOM object, not just a file handle.
- **Positive:** In-memory instances (no backing file) are first-class citizens via `fromDataset()`.
- **Positive:** Fluent immutable API aligns with the coding standard's immutability rule and enables safe chaining without side effects.
- **Positive:** Composing DicomDataset + ChangeSet + file path + metadata into one type simplifies the public API surface.
- **Negative:** Breaking change from the `DicomFile` API; existing consumers must update imports and usage.
- **Negative:** Every mutation allocates a new object, which adds minor GC pressure compared to in-place mutation.
