# Compression & Encoding Tools

Tools for compressing, decompressing, encapsulating, and decapsulating DICOM pixel data.

All tools return `Promise<Result<T>>` and accept optional `timeoutMs` and `signal` (AbortSignal) parameters.

---

## dcmcrle

Compress DICOM pixel data using RLE (Run-Length Encoding).

```typescript
import { dcmcrle } from '@ubercode/dcmtk';

const result = await dcmcrle({
    inputPath: '/path/to/image.dcm',
    outputPath: '/path/to/compressed.dcm',
});
```

| Option      | Type      | Default | Description                       |
| ----------- | --------- | ------- | --------------------------------- |
| `uidAlways` | `boolean` | —       | Always write new SOP Instance UID |

**Result:** `{ outputPath: string }`

---

## dcmdrle

Decompress RLE-encoded DICOM pixel data.

```typescript
import { dcmdrle } from '@ubercode/dcmtk';

const result = await dcmdrle({
    inputPath: '/path/to/compressed.dcm',
    outputPath: '/path/to/decompressed.dcm',
});
```

| Option      | Type      | Default | Description                       |
| ----------- | --------- | ------- | --------------------------------- |
| `uidAlways` | `boolean` | —       | Always write new SOP Instance UID |

**Result:** `{ outputPath: string }`

---

## dcmencap

Encapsulate already-compressed pixel data into a DICOM object.

```typescript
import { dcmencap } from '@ubercode/dcmtk';

const result = await dcmencap({
    inputPath: '/path/to/compressed-data',
    outputPath: '/path/to/output.dcm',
    documentTitle: 'Compressed Image',
});
```

| Option          | Type     | Default | Description                              |
| --------------- | -------- | ------- | ---------------------------------------- |
| `documentTitle` | `string` | —       | Document title for encapsulated document |

**Result:** `{ outputPath: string }`

---

## dcmdecap

Decapsulate compressed pixel data from a DICOM object.

```typescript
import { dcmdecap } from '@ubercode/dcmtk';

const result = await dcmdecap({
    inputPath: '/path/to/encapsulated.dcm',
    outputPath: '/path/to/extracted',
});
```

**Result:** `{ outputPath: string }`

---

## dcmcjpeg

Compress DICOM pixel data using JPEG.

```typescript
import { dcmcjpeg } from '@ubercode/dcmtk';

// Lossy JPEG compression
const result = await dcmcjpeg({
    inputPath: '/path/to/image.dcm',
    outputPath: '/path/to/compressed.dcm',
    quality: 90,
});

// Lossless JPEG compression
const lossless = await dcmcjpeg({
    inputPath: '/path/to/image.dcm',
    outputPath: '/path/to/compressed.dcm',
    lossless: true,
});
```

| Option     | Type      | Default | Description                         |
| ---------- | --------- | ------- | ----------------------------------- |
| `quality`  | `number`  | —       | JPEG quality factor (1-100)         |
| `lossless` | `boolean` | —       | Use lossless JPEG compression (SV1) |

**Result:** `{ outputPath: string }`

---

## dcmdjpeg

Decompress JPEG-encoded DICOM pixel data.

```typescript
import { dcmdjpeg, ColorConversion } from '@ubercode/dcmtk';

const result = await dcmdjpeg({
    inputPath: '/path/to/compressed.dcm',
    outputPath: '/path/to/decompressed.dcm',
    colorConversion: ColorConversion.PHOTOMETRIC,
});
```

| Option            | Type                   | Default | Description           |
| ----------------- | ---------------------- | ------- | --------------------- |
| `colorConversion` | `ColorConversionValue` | —       | Color conversion mode |

**ColorConversion constants:** `PHOTOMETRIC`, `ALWAYS`, `NEVER`

**Result:** `{ outputPath: string }`

---

## dcmcjpls

Compress DICOM pixel data using JPEG-LS.

```typescript
import { dcmcjpls } from '@ubercode/dcmtk';

// Lossless JPEG-LS
const result = await dcmcjpls({
    inputPath: '/path/to/image.dcm',
    outputPath: '/path/to/compressed.dcm',
    lossless: true,
});

// Near-lossless with maximum deviation
const nearLossless = await dcmcjpls({
    inputPath: '/path/to/image.dcm',
    outputPath: '/path/to/compressed.dcm',
    maxDeviation: 2,
});
```

| Option         | Type      | Default | Description                                |
| -------------- | --------- | ------- | ------------------------------------------ |
| `lossless`     | `boolean` | —       | Use lossless JPEG-LS compression           |
| `maxDeviation` | `number`  | —       | Max pixel deviation for near-lossless mode |

**Result:** `{ outputPath: string }`

---

## dcmdjpls

Decompress JPEG-LS-encoded DICOM pixel data.

```typescript
import { dcmdjpls, JplsColorConversion } from '@ubercode/dcmtk';

const result = await dcmdjpls({
    inputPath: '/path/to/compressed.dcm',
    outputPath: '/path/to/decompressed.dcm',
    colorConversion: JplsColorConversion.PHOTOMETRIC,
});
```

| Option            | Type                       | Default | Description           |
| ----------------- | -------------------------- | ------- | --------------------- |
| `colorConversion` | `JplsColorConversionValue` | —       | Color conversion mode |

**JplsColorConversion constants:** `PHOTOMETRIC`, `ALWAYS`, `NEVER`

**Result:** `{ outputPath: string }`
