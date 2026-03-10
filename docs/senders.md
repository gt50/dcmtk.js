# DicomSender — High-Throughput DICOM Sender

The `DicomSender` class provides a high-throughput DICOM sending abstraction with queuing, bucketing, and adaptive backpressure. It wraps `storescu` calls with three sending modes, automatic retry, and health monitoring.

## Quick Start

```typescript
import { DicomSender } from '@ubercode/dcmtk';

const result = DicomSender.create({
    host: '192.168.1.100',
    port: 104,
    calledAETitle: 'PACS',
});
if (!result.ok) {
    console.error(result.error.message);
    process.exit(1);
}
const sender = result.value;

sender.onSendComplete(data => console.log('Sent:', data.fileCount, 'files in', data.durationMs, 'ms'));
sender.onSendFailed(data => console.error('Failed:', data.error.message, 'after', data.attempts, 'attempts'));

const sendResult = await sender.send(['/path/to/file1.dcm', '/path/to/file2.dcm']);
if (sendResult.ok) {
    console.log('All files sent successfully');
}

await sender.stop();
```

## Sending Modes

### Single Mode

One association at a time. Additional `send()` calls queue in FIFO order. Use when the remote endpoint cannot handle concurrent connections.

```typescript
const result = DicomSender.create({
    host: 'pacs.hospital.org',
    port: 104,
    mode: 'single',
});
```

### Multiple Mode (default)

Up to N concurrent `storescu` calls. Each `send()` gets its own association. Best for high-throughput sending to capable endpoints.

```typescript
const result = DicomSender.create({
    host: 'pacs.hospital.org',
    port: 104,
    mode: 'multiple',
    maxAssociations: 8, // default: 4
});
```

### Bucket Mode

Files accumulate into buckets. Each bucket is flushed as a single `storescu` call with multiple files. Buckets flush automatically when reaching `maxBucketSize` or after `bucketFlushMs` timeout. Use when many small sends can be batched for efficiency.

```typescript
const result = DicomSender.create({
    host: 'pacs.hospital.org',
    port: 104,
    mode: 'bucket',
    maxAssociations: 4,
    maxBucketSize: 50, // flush after 50 files
    bucketFlushMs: 5000, // or after 5 seconds
});
if (!result.ok) return;
const sender = result.value;

// These three sends accumulate in one bucket
void sender.send(['/path/file1.dcm']);
void sender.send(['/path/file2.dcm']);
void sender.send(['/path/file3.dcm']);

// Force-flush the current bucket
sender.flush();
```

## Configuration Reference

| Option                   | Type                                 | Default      | Description                                                      |
| ------------------------ | ------------------------------------ | ------------ | ---------------------------------------------------------------- |
| `host`                   | `string`                             | (required)   | Remote host or IP address                                        |
| `port`                   | `number`                             | (required)   | Remote port (1-65535)                                            |
| `calledAETitle`          | `string`                             | —            | Remote AE Title (max 16 chars)                                   |
| `callingAETitle`         | `string`                             | —            | Local AE Title (max 16 chars)                                    |
| `mode`                   | `'single' \| 'multiple' \| 'bucket'` | `'multiple'` | Sending mode                                                     |
| `maxAssociations`        | `number`                             | `4`          | Max concurrent storescu calls (1-64, forced to 1 in single mode) |
| `proposedTransferSyntax` | `ProposedTransferSyntaxValue`        | —            | Transfer syntax proposal for associations                        |
| `maxQueueLength`         | `number`                             | `1000`       | Max queued send requests before rejecting                        |
| `timeoutMs`              | `number`                             | `30000`      | Per-storescu timeout in ms                                       |
| `maxRetries`             | `number`                             | `3`          | Max retry attempts per send (0 = no retry)                       |
| `retryDelayMs`           | `number`                             | `1000`       | Base retry delay in ms (multiplied by attempt number)            |
| `bucketFlushMs`          | `number`                             | `5000`       | Bucket flush timeout in ms (bucket mode only)                    |
| `maxBucketSize`          | `number`                             | `50`         | Max files per bucket (bucket mode only)                          |
| `maxPduReceive`          | `number`                             | —            | Maximum PDU receive size in bytes (4096-131072)                  |
| `maxPduSend`             | `number`                             | —            | Maximum PDU send size in bytes (4096-131072)                     |
| `associationTimeout`     | `number`                             | —            | Association/TCP timeout in seconds                               |
| `acseTimeout`            | `number`                             | —            | ACSE timeout in seconds                                          |
| `dimseTimeout`           | `number`                             | —            | DIMSE timeout in seconds                                         |
| `noHostnameLookup`       | `boolean`                            | —            | Disable DNS hostname lookup (useful in containers)               |
| `noUidChecks`            | `boolean`                            | —            | Disable UID validity checking                                    |
| `verbosity`              | `'verbose' \| 'debug'`               | —            | Diagnostic output level (`-v` or `-d`)                           |
| `signal`                 | `AbortSignal`                        | —            | AbortSignal for external cancellation                            |

## Per-Send Overrides

The `send()` method accepts optional overrides:

```typescript
await sender.send(['/path/file.dcm'], {
    timeoutMs: 60000, // override timeout for this send
    maxRetries: 5, // override retries for this send
    calledAETitle: 'OTHER_PACS', // override called AE for this send
    callingAETitle: 'MY_SCU', // override calling AE for this send
});
```

## Send Results

`SendResult` includes storescu output for diagnostics:

```typescript
const result = await sender.send(['/path/file.dcm']);
if (result.ok) {
    console.log('Sent:', result.value.fileCount, 'files');
    console.log('stdout:', result.value.stdout);
    console.log('stderr:', result.value.stderr);
}
```

## Backpressure

The sender monitors consecutive failures and successes to adaptively adjust the effective concurrency:

| Transition          | Trigger                                          | Effect                             |
| ------------------- | ------------------------------------------------ | ---------------------------------- |
| HEALTHY → DEGRADED  | 3 consecutive failures                           | Effective max halved               |
| DEGRADED → DEGRADED | 3 more consecutive failures                      | Effective max halved again (min 1) |
| DEGRADED → DOWN     | 10 total consecutive failures                    | Effective max = 1                  |
| DOWN → DEGRADED     | 3 consecutive successes                          | Effective max stays at 1           |
| DEGRADED → HEALTHY  | 3 consecutive successes (effective max restored) | Full concurrency restored          |

Monitor health state via the `status` getter or `onHealthChanged` event:

```typescript
sender.onHealthChanged(data => {
    console.warn(`Health: ${data.previousHealth} → ${data.newHealth}`);
    console.warn(`Effective associations: ${data.effectiveMaxAssociations}`);
});

// Check current status
const status = sender.status;
console.log(status.health); // 'healthy' | 'degraded' | 'down'
console.log(status.effectiveMaxAssociations);
console.log(status.consecutiveFailures);
```

## Events

| Event            | Data Type                 | When                            |
| ---------------- | ------------------------- | ------------------------------- |
| `SEND_COMPLETE`  | `SenderSendCompleteData`  | Each successful storescu call   |
| `SEND_FAILED`    | `SenderSendFailedData`    | After all retries exhausted     |
| `HEALTH_CHANGED` | `SenderHealthChangedData` | Health state transition         |
| `BUCKET_FLUSHED` | `SenderBucketFlushedData` | Bucket dispatched (bucket mode) |
| `error`          | `SenderErrorData`         | Internal errors                 |

Use typed listeners:

```typescript
sender.onSendComplete(data => {
    /* ... */
});
sender.onSendFailed(data => {
    /* ... */
});
sender.onHealthChanged(data => {
    /* ... */
});
sender.onBucketFlushed(data => {
    /* ... */
});
sender.onEvent('error', data => {
    /* ... */
});
```

## Lifecycle

```typescript
// Create (synchronous, validates options)
const result = DicomSender.create(options);
if (!result.ok) {
    /* handle error */
}
const sender = result.value;

// Ready to send immediately — no start() needed
await sender.send(['/file.dcm']);

// Graceful shutdown: rejects queued items, waits for active to complete
await sender.stop();
```

## API Summary

| Method                        | Returns                       | Description                              |
| ----------------------------- | ----------------------------- | ---------------------------------------- |
| `DicomSender.create(options)` | `Result<DicomSender>`         | Factory with Zod validation              |
| `send(files, options?)`       | `Promise<Result<SendResult>>` | Send files (resolves on actual send)     |
| `flush()`                     | `void`                        | Force-flush current bucket (bucket mode) |
| `stop()`                      | `Promise<void>`               | Graceful shutdown                        |
| `status`                      | `SenderStatus`                | Current state snapshot                   |
| `onSendComplete(listener)`    | `this`                        | Listen for successful sends              |
| `onSendFailed(listener)`      | `this`                        | Listen for failed sends                  |
| `onHealthChanged(listener)`   | `this`                        | Listen for health transitions            |
| `onBucketFlushed(listener)`   | `this`                        | Listen for bucket flushes                |
| `onEvent(event, listener)`    | `this`                        | Generic typed event listener             |
