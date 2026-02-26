# Core Concepts

This page covers the foundational patterns used throughout the `dcmtk` library: the Result type, branded types, timeouts, and cancellation.

## Result Pattern

All fallible operations return `Result<T, E>` — a discriminated union that replaces try/catch for expected failure modes.

```typescript
type Result<T, E = Error> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
```

### Narrowing

Check `result.ok` before accessing `.value` or `.error`:

```typescript
import { dcm2json } from 'dcmtk';

const result = await dcm2json('/path/to/image.dcm');

if (result.ok) {
    console.log(result.value.data); // TypeScript knows .value exists
} else {
    console.error(result.error.message); // TypeScript knows .error exists
}
```

### Helper Functions

| Function                | Signature                                                        | Description                      |
| ----------------------- | ---------------------------------------------------------------- | -------------------------------- |
| `ok(value)`             | `ok<T>(value: T): Result<T, never>`                              | Create a successful Result       |
| `err(error)`            | `err<E>(error: E): Result<never, E>`                             | Create a failed Result           |
| `unwrap(result)`        | `unwrap<T>(result: Result<T>): T`                                | Extract value or throw the error |
| `mapResult(result, fn)` | `mapResult<T, U>(result: Result<T>, fn: (v: T) => U): Result<U>` | Transform the success value      |

### Common Patterns

**Early return on failure:**

```typescript
const jsonResult = await dcm2json(inputPath);
if (!jsonResult.ok) return jsonResult; // propagate error

const dsResult = DicomDataset.fromJson(jsonResult.value.data);
if (!dsResult.ok) return dsResult;

console.log(dsResult.value.patientName);
```

**Unwrap for exception-style code:**

```typescript
import { unwrap } from 'dcmtk';

const { data } = unwrap(await dcm2json('/path/to/image.dcm'));
// throws if dcm2json fails
```

## Branded Types

Branded types prevent accidental mix-ups of primitive values at compile time. A `Port` cannot be passed where an `AETitle` is expected, even though both are ultimately numbers and strings.

| Type                | Underlying | Example               | Factory                      | Validator                   |
| ------------------- | ---------- | --------------------- | ---------------------------- | --------------------------- |
| `DicomTag`          | `string`   | `"(0010,0010)"`       | `createDicomTag(s)`          | `parseDicomTag(s)`          |
| `AETitle`           | `string`   | `"MY_SCP"`            | `createAETitle(s)`           | `parseAETitle(s)`           |
| `Port`              | `number`   | `4242`                | `createPort(n)`              | `parsePort(n)`              |
| `DicomTagPath`      | `string`   | `"(0010,0010)"`       | `createDicomTagPath(s)`      | `parseDicomTagPath(s)`      |
| `SOPClassUID`       | `string`   | `"1.2.840.10008..."`  | `createSOPClassUID(s)`       | `parseSOPClassUID(s)`       |
| `TransferSyntaxUID` | `string`   | `"1.2.840.10008..."`  | `createTransferSyntaxUID(s)` | `parseTransferSyntaxUID(s)` |
| `DicomFilePath`     | `string`   | `"/path/to/file.dcm"` | `createDicomFilePath(s)`     | —                           |

### Factory vs Validator

- **Factory functions** (`create*`) return `Result<T>` and validate the input format. Use when you have trusted or already-validated input.
- **Validator functions** (`parse*`) also return `Result<T>` and are intended for runtime validation of untrusted user input via Zod schemas.

```typescript
import { createAETitle, parseAETitle } from 'dcmtk';

// Factory — trusted input
const aeTitle = createAETitle('MY_SCP');
if (!aeTitle.ok) {
    /* handle */
}

// Validator — untrusted user input
const parsed = parseAETitle(userInput);
if (parsed.ok) {
    console.log('Valid:', parsed.value);
} else {
    console.error('Invalid:', parsed.error.message);
}
```

## Timeouts

Every async operation accepts an optional `timeoutMs` parameter. The default timeout is 30 seconds (30,000 ms).

```typescript
import { storescu } from 'dcmtk';

const result = await storescu({
    host: '192.168.1.100',
    port: 4242,
    files: ['/path/to/large-study.dcm'],
    timeoutMs: 120_000, // 2 minutes
});
```

The `ToolBaseOptions` interface provides these shared fields for all tool wrappers:

```typescript
interface ToolBaseOptions {
    readonly timeoutMs?: number;
    readonly signal?: AbortSignal;
}
```

## Cancellation with AbortSignal

All tools and servers support cancellation via the standard `AbortController`:

```typescript
import { dcm2json } from 'dcmtk';

const controller = new AbortController();

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5_000);

const result = await dcm2json('/path/to/large-file.dcm', {
    signal: controller.signal,
    timeoutMs: 60_000,
});

if (!result.ok) {
    console.error('Aborted or failed:', result.error.message);
}
```

Servers also accept `AbortSignal` in their create options:

```typescript
import { Dcmrecv } from 'dcmtk';

const controller = new AbortController();
const server = Dcmrecv.create({
    port: 4242,
    outputDirectory: './incoming',
    signal: controller.signal,
});

// Later: abort stops the server
controller.abort();
```
