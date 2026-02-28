# Presentation State & Print Tools

Tools for creating and managing DICOM Grayscale Softcopy Presentation States (GSPS), print management, and display calibration data.

All tools return `Promise<Result<T>>` and accept optional `timeoutMs` and `signal` (AbortSignal) parameters.

---

## dcmpsmk

Create a DICOM Grayscale Softcopy Presentation State from a DICOM image.

```typescript
import { dcmpsmk } from '@ubercode/dcmtk';

const result = await dcmpsmk({
    inputPath: '/path/to/image.dcm',
    outputPath: '/path/to/pstate.dcm',
});
```

**Result:** `{ outputPath: string }`

---

## dcmpschk

Check the validity of a DICOM Presentation State object.

```typescript
import { dcmpschk } from '@ubercode/dcmtk';

const result = await dcmpschk({
    inputPath: '/path/to/pstate.dcm',
});

if (result.ok) {
    console.log(result.value.text);
}
```

**Result:** `{ text: string }`

---

## dcmprscu

Send a print job to a DICOM Print Management SCP.

```typescript
import { dcmprscu } from '@ubercode/dcmtk';

const result = await dcmprscu({
    host: '192.168.1.100',
    port: 4242,
    inputPath: '/path/to/pstate.dcm',
    calledAETitle: 'PRINT_SCP',
});
```

| Option           | Type     | Default | Description                             |
| ---------------- | -------- | ------- | --------------------------------------- |
| `host`           | `string` | —       | **Required.** Remote host or IP address |
| `port`           | `number` | —       | **Required.** Remote port number        |
| `callingAETitle` | `string` | —       | Calling AE Title (max 16 chars)         |
| `calledAETitle`  | `string` | —       | Called AE Title (max 16 chars)          |
| `configFile`     | `string` | —       | Path to configuration file              |

**Result:** `{ success: boolean, stderr: string }`

---

## dcmpsprt

Print a presentation state using a configured printer.

```typescript
import { dcmpsprt } from '@ubercode/dcmtk';

const result = await dcmpsprt({
    inputPath: '/path/to/pstate.dcm',
    configFile: '/path/to/dcmpstat.cfg',
});
```

| Option       | Type     | Default | Description                |
| ------------ | -------- | ------- | -------------------------- |
| `configFile` | `string` | —       | Path to configuration file |

**Result:** `{ text: string }`

---

## dcmp2pgm

Render a DICOM image with a presentation state applied, producing a PGM output.

```typescript
import { dcmp2pgm } from '@ubercode/dcmtk';

const result = await dcmp2pgm({
    inputPath: '/path/to/image.dcm',
    outputPath: '/path/to/rendered.pgm',
    presentationState: '/path/to/pstate.dcm',
    frame: 0,
});
```

| Option              | Type     | Default | Description                                 |
| ------------------- | -------- | ------- | ------------------------------------------- |
| `presentationState` | `string` | —       | Path to DICOM presentation state file       |
| `frame`             | `number` | —       | Frame number to render (0-based, max 65535) |

**Result:** `{ outputPath: string }`

---

## dcmmkcrv

Create DICOM curve data and add it to a DICOM file.

```typescript
import { dcmmkcrv } from '@ubercode/dcmtk';

const result = await dcmmkcrv({
    inputPath: '/path/to/data.txt',
    outputPath: '/path/to/output.dcm',
});
```

**Result:** `{ outputPath: string }`

---

## dcmmklut

Create a DICOM Modality, Presentation, or VOI lookup table.

```typescript
import { dcmmklut, LutType } from '@ubercode/dcmtk';

const result = await dcmmklut({
    inputPath: '/path/to/image.dcm',
    outputPath: '/path/to/output.dcm',
    lutType: LutType.VOI,
    gamma: 2.2,
    entries: 256,
    bits: 12,
});
```

| Option    | Type           | Default | Description                                       |
| --------- | -------------- | ------- | ------------------------------------------------- |
| `lutType` | `LutTypeValue` | —       | LUT type: `'modality'`, `'presentation'`, `'voi'` |
| `gamma`   | `number`       | —       | Gamma value for the LUT curve                     |
| `entries` | `number`       | —       | Number of entries in the LUT                      |
| `bits`    | `number`       | —       | Bits per LUT entry (8-16)                         |

**LutType constants:** `MODALITY`, `PRESENTATION`, `VOI`

**Result:** `{ outputPath: string }`
