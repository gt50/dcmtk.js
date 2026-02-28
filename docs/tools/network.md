# Network Tools

Tools for DICOM network operations: connectivity testing, file transfer, querying, and retrieval.

All tools return `Promise<Result<T>>` and accept optional `timeoutMs` and `signal` (AbortSignal) parameters.

---

## echoscu

Test DICOM connectivity using C-ECHO (verification).

```typescript
import { echoscu } from '@ubercode/dcmtk';

const result = await echoscu({
    host: '192.168.1.100',
    port: 4242,
    calledAETitle: 'PACS_SCP',
    callingAETitle: 'MY_SCU',
});

if (result.ok) {
    console.log('PACS is reachable');
}
```

| Option           | Type     | Default | Description                             |
| ---------------- | -------- | ------- | --------------------------------------- |
| `host`           | `string` | —       | **Required.** Remote host or IP address |
| `port`           | `number` | —       | **Required.** Remote port number        |
| `callingAETitle` | `string` | —       | Calling AE Title (max 16 chars)         |
| `calledAETitle`  | `string` | —       | Called AE Title (max 16 chars)          |

**Result:** `{ success: boolean, stderr: string }`

---

## dcmsend

Send DICOM files using C-STORE (lightweight sender).

```typescript
import { dcmsend } from '@ubercode/dcmtk';

const result = await dcmsend({
    host: '192.168.1.100',
    port: 4242,
    files: ['/path/to/image1.dcm', '/path/to/image2.dcm'],
    calledAETitle: 'PACS_SCP',
});
```

| Option           | Type       | Default | Description                             |
| ---------------- | ---------- | ------- | --------------------------------------- |
| `host`           | `string`   | —       | **Required.** Remote host or IP address |
| `port`           | `number`   | —       | **Required.** Remote port number        |
| `files`          | `string[]` | —       | **Required.** DICOM file paths to send  |
| `callingAETitle` | `string`   | —       | Calling AE Title (max 16 chars)         |
| `calledAETitle`  | `string`   | —       | Called AE Title (max 16 chars)          |
| `scanDirectory`  | `boolean`  | —       | Scan input directory recursively        |

**Result:** `{ success: boolean, stderr: string }`

---

## storescu

Send DICOM files using C-STORE (full-featured SCU with more options than dcmsend).

```typescript
import { storescu } from '@ubercode/dcmtk';

const result = await storescu({
    host: '192.168.1.100',
    port: 4242,
    files: ['/path/to/image1.dcm', '/path/to/image2.dcm'],
    calledAETitle: 'PACS_SCP',
    scanDirectories: true,
    recurse: true,
});
```

| Option            | Type       | Default | Description                             |
| ----------------- | ---------- | ------- | --------------------------------------- |
| `host`            | `string`   | —       | **Required.** Remote host or IP address |
| `port`            | `number`   | —       | **Required.** Remote port number        |
| `files`           | `string[]` | —       | **Required.** DICOM file paths to send  |
| `callingAETitle`  | `string`   | —       | Calling AE Title (max 16 chars)         |
| `calledAETitle`   | `string`   | —       | Called AE Title (max 16 chars)          |
| `scanDirectories` | `boolean`  | —       | Scan directories for DICOM files        |
| `recurse`         | `boolean`  | —       | Recurse into subdirectories             |

**Result:** `{ success: boolean, stderr: string }`

---

## findscu

Query a remote SCP using C-FIND.

```typescript
import { findscu, QueryModel } from '@ubercode/dcmtk';

const result = await findscu({
    host: '192.168.1.100',
    port: 4242,
    calledAETitle: 'PACS_SCP',
    queryModel: QueryModel.STUDY,
    keys: [
        '0010,0020=PATIENT-001', // Patient ID
        '0008,0050=', // Return Accession Number
        '0008,0020=20240101-', // Study Date from Jan 1, 2024
    ],
});
```

| Option            | Type              | Default | Description                                       |
| ----------------- | ----------------- | ------- | ------------------------------------------------- |
| `host`            | `string`          | —       | **Required.** Remote host or IP address           |
| `port`            | `number`          | —       | **Required.** Remote port number                  |
| `callingAETitle`  | `string`          | —       | Calling AE Title (max 16 chars)                   |
| `calledAETitle`   | `string`          | —       | Called AE Title (max 16 chars)                    |
| `queryModel`      | `QueryModelValue` | —       | Query model: `'worklist'`, `'patient'`, `'study'` |
| `keys`            | `string[]`        | —       | DICOM attribute key strings                       |
| `extract`         | `boolean`         | —       | Extract response datasets to individual files     |
| `outputDirectory` | `string`          | —       | Output directory for extracted files              |

**QueryModel constants:** `WORKLIST`, `PATIENT`, `STUDY`

**Result:** `{ success: boolean, stderr: string }`

For higher-level query operations with parsed results, see [PacsClient](../pacs-client.md).

---

## movescu

Retrieve DICOM objects from a remote SCP using C-MOVE.

```typescript
import { movescu, MoveQueryModel } from '@ubercode/dcmtk';

const result = await movescu({
    host: '192.168.1.100',
    port: 4242,
    calledAETitle: 'PACS_SCP',
    queryModel: MoveQueryModel.STUDY,
    keys: ['0008,0052=STUDY', '0020,000d=1.2.3.4.5'],
    moveDestination: 'MY_SCP',
    outputDirectory: '/tmp/retrieved',
});
```

| Option            | Type                  | Default | Description                             |
| ----------------- | --------------------- | ------- | --------------------------------------- |
| `host`            | `string`              | —       | **Required.** Remote host or IP address |
| `port`            | `number`              | —       | **Required.** Remote port number        |
| `callingAETitle`  | `string`              | —       | Calling AE Title (max 16 chars)         |
| `calledAETitle`   | `string`              | —       | Called AE Title (max 16 chars)          |
| `queryModel`      | `MoveQueryModelValue` | —       | Query model: `'patient'` or `'study'`   |
| `keys`            | `string[]`            | —       | DICOM attribute key strings             |
| `moveDestination` | `string`              | —       | Destination AE Title to send objects to |
| `outputDirectory` | `string`              | —       | Output directory for retrieved files    |

**MoveQueryModel constants:** `PATIENT`, `STUDY`

**Result:** `{ success: boolean, stderr: string }`

---

## getscu

Retrieve DICOM objects from a remote SCP using C-GET (pull directly).

```typescript
import { getscu, GetQueryModel } from '@ubercode/dcmtk';

const result = await getscu({
    host: '192.168.1.100',
    port: 4242,
    calledAETitle: 'PACS_SCP',
    queryModel: GetQueryModel.STUDY,
    keys: ['0008,0052=STUDY', '0020,000d=1.2.3.4.5'],
    outputDirectory: '/tmp/retrieved',
});
```

| Option            | Type                 | Default | Description                             |
| ----------------- | -------------------- | ------- | --------------------------------------- |
| `host`            | `string`             | —       | **Required.** Remote host or IP address |
| `port`            | `number`             | —       | **Required.** Remote port number        |
| `callingAETitle`  | `string`             | —       | Calling AE Title (max 16 chars)         |
| `calledAETitle`   | `string`             | —       | Called AE Title (max 16 chars)          |
| `queryModel`      | `GetQueryModelValue` | —       | Query model: `'patient'` or `'study'`   |
| `keys`            | `string[]`           | —       | DICOM attribute key strings             |
| `outputDirectory` | `string`             | —       | Output directory for retrieved files    |

**GetQueryModel constants:** `PATIENT`, `STUDY`

**Result:** `{ success: boolean, stderr: string }`

---

## termscu

Terminate a DICOM association on a remote SCP.

```typescript
import { termscu } from '@ubercode/dcmtk';

const result = await termscu({
    host: '192.168.1.100',
    port: 4242,
});
```

| Option           | Type     | Default | Description                             |
| ---------------- | -------- | ------- | --------------------------------------- |
| `host`           | `string` | —       | **Required.** Remote host or IP address |
| `port`           | `number` | —       | **Required.** Remote port number        |
| `callingAETitle` | `string` | —       | Calling AE Title (max 16 chars)         |
| `calledAETitle`  | `string` | —       | Called AE Title (max 16 chars)          |

**Result:** `{ success: boolean, stderr: string }`
