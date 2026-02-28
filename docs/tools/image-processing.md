# Image Processing Tools

Tools for converting DICOM images to standard image formats and performing image transformations.

All tools return `Promise<Result<T>>` and accept optional `timeoutMs` and `signal` (AbortSignal) parameters.

---

## dcmj2pnm

Convert a DICOM image to a standard image format (BMP, JPEG, PNG, TIFF, PNM).

```typescript
import { dcmj2pnm, Dcmj2pnmOutputFormat } from '@ubercode/dcmtk';

const result = await dcmj2pnm('/path/to/image.dcm', '/path/to/image.png', {
    outputFormat: Dcmj2pnmOutputFormat.PNG,
});
```

| Option         | Type                   | Default | Description                                                  |
| -------------- | ---------------------- | ------- | ------------------------------------------------------------ |
| `outputFormat` | `Dcmj2pnmOutputFormat` | `'pnm'` | Output format: `'pnm'`, `'png'`, `'bmp'`, `'tiff'`, `'jpeg'` |
| `frame`        | `number`               | —       | Frame number to extract (0-based, max 65535)                 |

**Result:** `{ outputPath: string }`

---

## dcm2pnm

Convert a DICOM image to PNM/PGM/PPM or other formats. Similar to dcmj2pnm but without JPEG output support.

```typescript
import { dcm2pnm, Dcm2pnmOutputFormat } from '@ubercode/dcmtk';

const result = await dcm2pnm('/path/to/image.dcm', '/path/to/image.bmp', {
    outputFormat: Dcm2pnmOutputFormat.BMP,
});
```

| Option         | Type                  | Default | Description                                        |
| -------------- | --------------------- | ------- | -------------------------------------------------- |
| `outputFormat` | `Dcm2pnmOutputFormat` | `'pnm'` | Output format: `'pnm'`, `'png'`, `'bmp'`, `'tiff'` |
| `frame`        | `number`              | —       | Frame number to extract (0-based, max 65535)       |

**Result:** `{ outputPath: string }`

---

## dcmscale

Scale (resize) DICOM images by factor or target dimensions.

```typescript
import { dcmscale } from '@ubercode/dcmtk';

// Scale by factor
const result = await dcmscale({
    inputPath: '/path/to/image.dcm',
    outputPath: '/path/to/scaled.dcm',
    xFactor: 0.5,
    yFactor: 0.5,
});

// Scale to specific dimensions
const result2 = await dcmscale({
    inputPath: '/path/to/image.dcm',
    outputPath: '/path/to/scaled.dcm',
    xSize: 256,
    ySize: 256,
});
```

| Option    | Type     | Default | Description                         |
| --------- | -------- | ------- | ----------------------------------- |
| `xFactor` | `number` | —       | Horizontal scaling factor (max 100) |
| `yFactor` | `number` | —       | Vertical scaling factor (max 100)   |
| `xSize`   | `number` | —       | Target width in pixels              |
| `ySize`   | `number` | —       | Target height in pixels             |

**Result:** `{ outputPath: string }`

---

## dcmquant

Color-quantize DICOM images (reduce color palette).

```typescript
import { dcmquant } from '@ubercode/dcmtk';

const result = await dcmquant({
    inputPath: '/path/to/image.dcm',
    outputPath: '/path/to/quantized.dcm',
    colors: 256,
});
```

| Option   | Type     | Default | Description                                  |
| -------- | -------- | ------- | -------------------------------------------- |
| `colors` | `number` | —       | Number of colors in palette (2-65536)        |
| `frame`  | `number` | —       | Frame number to extract (0-based, max 65535) |

**Result:** `{ outputPath: string }`

---

## dcmdspfn

Display function utilities for monitor/camera/printer calibration.

```typescript
import { dcmdspfn } from '@ubercode/dcmtk';

const result = await dcmdspfn({
    monitorFile: '/path/to/monitor.lut',
});
if (result.ok) {
    console.log(result.value.text);
}
```

| Option         | Type     | Default | Description                          |
| -------------- | -------- | ------- | ------------------------------------ |
| `monitorFile`  | `string` | —       | Path to monitor characteristics file |
| `cameraFile`   | `string` | —       | Path to camera characteristics file  |
| `printerFile`  | `string` | —       | Path to printer characteristics file |
| `ambientLight` | `number` | —       | Ambient light value in cd/m2         |

**Result:** `{ text: string }`

---

## dcod2lum

Convert optical density (OD) values to luminance.

```typescript
import { dcod2lum } from '@ubercode/dcmtk';

const result = await dcod2lum({
    inputPath: '/path/to/input.lut',
    outputPath: '/path/to/output.lut',
});
```

**Result:** `{ outputPath: string }`

---

## dconvlum

Convert luminance calibration data between formats.

```typescript
import { dconvlum } from '@ubercode/dcmtk';

const result = await dconvlum({
    inputPath: '/path/to/input.lut',
    outputPath: '/path/to/output.lut',
    ambientLight: 10,
});
```

| Option         | Type     | Default | Description                  |
| -------------- | -------- | ------- | ---------------------------- |
| `ambientLight` | `number` | —       | Ambient light value in cd/m2 |

**Result:** `{ outputPath: string }`
