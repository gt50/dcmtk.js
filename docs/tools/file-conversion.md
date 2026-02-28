# File Conversion Tools

Tools for converting between DICOM and other file formats (XML, JSON, dump text, images, PDF, CDA, STL).

All tools return `Promise<Result<T>>` and accept optional `timeoutMs` and `signal` (AbortSignal) parameters.

---

## xml2dcm

Convert an XML file to DICOM format.

```typescript
import { xml2dcm } from '@ubercode/dcmtk';

const result = await xml2dcm({
    inputPath: '/path/to/input.xml',
    outputPath: '/path/to/output.dcm',
});
```

| Option             | Type      | Default | Description                                 |
| ------------------ | --------- | ------- | ------------------------------------------- |
| `generateNewUIDs`  | `boolean` | —       | Generate new Study/Series/SOP Instance UIDs |
| `validateDocument` | `boolean` | —       | Validate the XML document                   |

**Result:** `{ outputPath: string }`

---

## json2dcm

Convert a DICOM JSON Model file to DICOM format.

```typescript
import { json2dcm } from '@ubercode/dcmtk';

const result = await json2dcm({
    inputPath: '/path/to/input.json',
    outputPath: '/path/to/output.dcm',
});
```

**Result:** `{ outputPath: string }`

---

## dump2dcm

Convert a DCMTK dump text file to DICOM format.

```typescript
import { dump2dcm } from '@ubercode/dcmtk';

const result = await dump2dcm({
    inputPath: '/path/to/input.txt',
    outputPath: '/path/to/output.dcm',
    writeFileFormat: true,
});
```

| Option            | Type      | Default | Description                                            |
| ----------------- | --------- | ------- | ------------------------------------------------------ |
| `generateNewUIDs` | `boolean` | —       | Generate new Study/Series/SOP Instance UIDs            |
| `writeFileFormat` | `boolean` | —       | Write as DICOM file format with preamble + meta header |

**Result:** `{ outputPath: string }`

---

## img2dcm

Convert a raster image (JPEG, BMP) to DICOM format.

```typescript
import { img2dcm, Img2dcmInputFormat } from '@ubercode/dcmtk';

const result = await img2dcm('/path/to/photo.jpg', '/path/to/output.dcm', {
    inputFormat: Img2dcmInputFormat.JPEG,
});
```

| Option        | Type                 | Default | Description                                |
| ------------- | -------------------- | ------- | ------------------------------------------ |
| `inputFormat` | `Img2dcmInputFormat` | —       | Input image format: `'jpeg'` or `'bmp'`    |
| `datasetFrom` | `string`             | —       | Path to DICOM file to copy attributes from |

**Result:** `{ outputPath: string }`

---

## pdf2dcm

Encapsulate a PDF file inside a DICOM object.

```typescript
import { pdf2dcm } from '@ubercode/dcmtk';

const result = await pdf2dcm({
    inputPath: '/path/to/report.pdf',
    outputPath: '/path/to/output.dcm',
});
```

**Result:** `{ outputPath: string }`

---

## dcm2pdf

Extract an encapsulated PDF from a DICOM object.

```typescript
import { dcm2pdf } from '@ubercode/dcmtk';

const result = await dcm2pdf({
    inputPath: '/path/to/encapsulated.dcm',
    outputPath: '/path/to/extracted.pdf',
});
```

**Result:** `{ outputPath: string }`

---

## cda2dcm

Encapsulate a CDA (Clinical Document Architecture) file inside a DICOM object.

```typescript
import { cda2dcm } from '@ubercode/dcmtk';

const result = await cda2dcm({
    inputPath: '/path/to/document.xml',
    outputPath: '/path/to/output.dcm',
});
```

**Result:** `{ outputPath: string }`

---

## dcm2cda

Extract an encapsulated CDA document from a DICOM object.

```typescript
import { dcm2cda } from '@ubercode/dcmtk';

const result = await dcm2cda({
    inputPath: '/path/to/encapsulated.dcm',
    outputPath: '/path/to/extracted.xml',
});
```

**Result:** `{ outputPath: string }`

---

## stl2dcm

Encapsulate an STL (3D surface mesh) file inside a DICOM object.

```typescript
import { stl2dcm } from '@ubercode/dcmtk';

const result = await stl2dcm({
    inputPath: '/path/to/model.stl',
    outputPath: '/path/to/output.dcm',
});
```

**Result:** `{ outputPath: string }`
