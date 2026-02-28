# Utilities

Helper functions for parallel processing and retry logic.

## batch

Process an array of items in parallel with configurable concurrency control.

```typescript
import { batch } from '@ubercode/dcmtk';
```

### Signature

```typescript
function batch<TItem, TResult>(
    items: readonly TItem[],
    operation: (item: TItem) => Promise<Result<TResult>>,
    options?: BatchOptions<TResult>
): Promise<BatchResult<TResult>>;
```

### Options

| Option        | Type                                                            | Default | Description                                           |
| ------------- | --------------------------------------------------------------- | ------- | ----------------------------------------------------- |
| `concurrency` | `number`                                                        | `4`     | Max parallel operations (clamped to 1-64)             |
| `onProgress`  | `(item: TItem, result: Result<TResult>, index: number) => void` | —       | Called after each item completes                      |
| `signal`      | `AbortSignal`                                                   | —       | Cancel remaining work (in-flight operations complete) |

### Result

```typescript
interface BatchResult<T> {
    readonly results: ReadonlyArray<Result<T>>;
    readonly successCount: number;
    readonly failureCount: number;
}
```

### Example

```typescript
import { batch, dcmftest } from '@ubercode/dcmtk';

const files = ['a.dcm', 'b.dcm', 'c.dcm', 'd.dcm', 'e.dcm'];

const batchResult = await batch(files, file => dcmftest({ inputPath: file }), {
    concurrency: 3,
    onProgress: (file, result, index) => {
        console.log(`[${index + 1}/${files.length}] ${file}: ${result.ok ? 'ok' : 'fail'}`);
    },
});

console.log(`${batchResult.successCount} succeeded, ${batchResult.failureCount} failed`);
```

## retry

Retry a fallible operation with exponential backoff and jitter.

```typescript
import { retry } from '@ubercode/dcmtk';
```

### Signature

```typescript
function retry<T>(fn: () => Promise<Result<T>>, options?: RetryOptions): Promise<Result<T>>;
```

### Options

| Option              | Type                                                       | Default       | Description                                  |
| ------------------- | ---------------------------------------------------------- | ------------- | -------------------------------------------- |
| `maxAttempts`       | `number`                                                   | `3`           | Total attempts (including the first)         |
| `initialDelayMs`    | `number`                                                   | `1000`        | Delay before first retry                     |
| `maxDelayMs`        | `number`                                                   | `30000`       | Maximum delay cap                            |
| `backoffMultiplier` | `number`                                                   | `2`           | Multiplier applied to delay each retry       |
| `shouldRetry`       | `(error: Error, attempt: number) => boolean`               | always `true` | Predicate to decide whether to retry         |
| `onRetry`           | `(error: Error, attempt: number, delayMs: number) => void` | —             | Called before each retry with computed delay |
| `signal`            | `AbortSignal`                                              | —             | Cancel retrying between attempts             |

A 10% jitter is applied to each computed delay to prevent thundering herd.

### Example

```typescript
import { retry, echoscu } from '@ubercode/dcmtk';

const result = await retry(() => echoscu({ host: '192.168.1.100', port: 4242 }), {
    maxAttempts: 5,
    initialDelayMs: 2000,
    onRetry: (err, attempt, delay) => {
        console.log(`Attempt ${attempt} failed: ${err.message}. Retrying in ${delay}ms...`);
    },
    shouldRetry: err => err.message.includes('ECONNREFUSED'),
});

if (result.ok) {
    console.log('PACS is reachable');
}
```
