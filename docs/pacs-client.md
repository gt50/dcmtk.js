# PacsClient

High-level PACS client encapsulating DICOM network operations. Configure the connection once, then call friendly methods for Echo, Query, Retrieve, and Store.

## Creating a Client

```typescript
import { PacsClient, unwrap } from 'dcmtk';

const client = unwrap(
    PacsClient.create({
        host: '192.168.1.100',
        port: 104,
        calledAETitle: 'PACS',
        callingAETitle: 'MY_APP',
        timeoutMs: 30_000,
    })
);
```

### PacsClientConfig

| Option           | Type     | Default     | Description                             |
| ---------------- | -------- | ----------- | --------------------------------------- |
| `host`           | `string` | —           | **Required.** Remote host or IP address |
| `port`           | `number` | —           | **Required.** Remote port (1-65535)     |
| `callingAETitle` | `string` | `'DCMTK'`   | Local AE Title (1-16 chars)             |
| `calledAETitle`  | `string` | `'ANY-SCP'` | Remote AE Title (1-16 chars)            |
| `timeoutMs`      | `number` | `30000`     | Default timeout for all operations      |

## Methods

All methods accept optional `timeoutMs` and `signal` overrides via their options parameter.

### echo

Test DICOM connectivity using C-ECHO.

```typescript
const result = await client.echo();
if (result.ok) {
    console.log(`RTT: ${result.value.rttMs}ms`);
}
```

**Result:** `{ success: boolean, rttMs: number }`

### findStudies

Query for studies matching filter criteria. Returns parsed `DicomDataset[]`.

```typescript
const result = await client.findStudies({
    patientId: 'PAT001',
    studyDate: '20240101-20241231',
    modality: 'CT',
});

if (result.ok) {
    for (const ds of result.value) {
        console.log(ds.patientName, ds.studyDate, ds.accession);
    }
}
```

**StudyFilter options:** `patientId`, `patientName`, `studyDate`, `accessionNumber`, `modality`, `studyInstanceUID`, `studyDescription`

### findSeries

Query for series within a study.

```typescript
const result = await client.findSeries({
    studyInstanceUID: '1.2.3.4.5',
    modality: 'CT',
});
```

**SeriesFilter options:** `studyInstanceUID` (required), `modality`, `seriesNumber`, `seriesInstanceUID`, `seriesDescription`

### findImages

Query for images within a series.

```typescript
const result = await client.findImages({
    studyInstanceUID: '1.2.3.4.5',
    seriesInstanceUID: '1.2.3.4.5.6',
});
```

**ImageFilter options:** `studyInstanceUID` (required), `seriesInstanceUID` (required), `instanceNumber`, `sopInstanceUID`, `sopClassUID`

### findWorklist

Query a worklist SCP with raw DICOM keys.

```typescript
const result = await client.findWorklist({
    keys: ['0040,0100.0008,0060=CT'],
});
```

**WorklistFilter options:** `keys` (required) — array of raw DICOM key strings

### find

Execute a raw C-FIND query with arbitrary `-k` arguments.

```typescript
const result = await client.find([
    '0008,0052=STUDY',
    '0010,0020=PAT001',
    '0008,0050=', // return all accession numbers
]);
```

### retrieveStudy

Retrieve a study by Study Instance UID using C-GET (default) or C-MOVE.

```typescript
// C-GET (default) — files come directly to you
const result = await client.retrieveStudy('1.2.3.4.5', {
    outputDirectory: '/tmp/dicom',
});

// C-MOVE — files are pushed to a separate destination
const result2 = await client.retrieveStudy('1.2.3.4.5', {
    outputDirectory: '/tmp/dicom',
    mode: RetrieveMode.C_MOVE,
    moveDestination: 'DEST_SCP',
});
```

**Result:** `{ success: boolean, outputDirectory: string }`

### retrieveSeries

Retrieve a specific series by Study + Series Instance UIDs.

```typescript
const result = await client.retrieveSeries('1.2.3.4.5', '1.2.3.4.5.6', {
    outputDirectory: '/tmp/dicom',
});
```

### store

Send DICOM files to the remote SCP using C-STORE.

```typescript
const result = await client.store(['/path/to/image1.dcm', '/path/to/image2.dcm']);

if (result.ok) {
    console.log(`Sent ${result.value.fileCount} files`);
}
```

**PacsStoreOptions:** `scanDirectories`, `recurse`, `timeoutMs`, `signal`

**Result:** `{ success: boolean, fileCount: number }`

## Query Options

All query methods (`findStudies`, `findSeries`, `findImages`, `findWorklist`, `find`) accept `PacsQueryOptions`:

| Option             | Type          | Default        | Description                               |
| ------------------ | ------------- | -------------- | ----------------------------------------- |
| `parseConcurrency` | `number`      | `5`            | Max parallel file parse operations (1-64) |
| `timeoutMs`        | `number`      | client default | Override timeout for this operation       |
| `signal`           | `AbortSignal` | —              | Cancel this operation                     |

## Retrieve Modes

```typescript
import { RetrieveMode } from 'dcmtk';
```

| Mode                  | Value      | Description                              |
| --------------------- | ---------- | ---------------------------------------- |
| `RetrieveMode.C_GET`  | `'C_GET'`  | Pull files directly (default)            |
| `RetrieveMode.C_MOVE` | `'C_MOVE'` | Push files to a specified destination AE |

## Full Workflow Example

```typescript
import { PacsClient, RetrieveMode, unwrap } from 'dcmtk';

const client = unwrap(
    PacsClient.create({
        host: '192.168.1.100',
        port: 104,
        calledAETitle: 'PACS',
    })
);

// 1. Verify connectivity
const echo = await client.echo();
if (!echo.ok) throw echo.error;
console.log(`Connected (${echo.value.rttMs}ms RTT)`);

// 2. Find studies for a patient
const studies = await client.findStudies({ patientId: 'PAT001' });
if (!studies.ok) throw studies.error;

for (const study of studies.value) {
    console.log(`Study: ${study.studyDate} - ${study.getString('00081030')}`);
}

// 3. Retrieve the first study
const firstStudy = studies.value[0];
if (firstStudy) {
    const uid = firstStudy.studyInstanceUID;
    const retrieve = await client.retrieveStudy(uid, {
        outputDirectory: '/tmp/dicom-out',
    });
    if (retrieve.ok) {
        console.log(`Retrieved to: ${retrieve.value.outputDirectory}`);
    }
}
```
