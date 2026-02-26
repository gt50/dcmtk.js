# Structured Report Tools

Tools for working with DICOM Structured Reports (SR) and Radiation Therapy (RT) objects.

All tools return `Promise<Result<T>>` and accept optional `timeoutMs` and `signal` (AbortSignal) parameters.

---

## dsrdump

Dump the contents of a DICOM Structured Report as text.

```typescript
import { dsrdump } from 'dcmtk';

const result = await dsrdump({
    inputPath: '/path/to/report.dcm',
    printLong: true,
});

if (result.ok) {
    console.log(result.value.text);
}
```

| Option          | Type      | Default | Description                             |
| --------------- | --------- | ------- | --------------------------------------- |
| `printFilename` | `boolean` | —       | Print filename for each document        |
| `printLong`     | `boolean` | —       | Print long format with enhanced details |
| `printCodes`    | `boolean` | —       | Print concept name codes                |

**Result:** `{ text: string }`

---

## dsr2xml

Convert a DICOM Structured Report to XML.

```typescript
import { dsr2xml } from 'dcmtk';

const result = await dsr2xml({
    inputPath: '/path/to/report.dcm',
    useNamespace: true,
});

if (result.ok) {
    console.log(result.value.text);
}
```

| Option         | Type      | Default | Description              |
| -------------- | --------- | ------- | ------------------------ |
| `useNamespace` | `boolean` | —       | Use XML namespace        |
| `addSchemaRef` | `boolean` | —       | Add XML Schema reference |

**Result:** `{ text: string }`

---

## xml2dsr

Convert an XML file to a DICOM Structured Report.

```typescript
import { xml2dsr } from 'dcmtk';

const result = await xml2dsr({
    inputPath: '/path/to/report.xml',
    outputPath: '/path/to/report.dcm',
    validateDocument: true,
});
```

| Option             | Type      | Default | Description                                 |
| ------------------ | --------- | ------- | ------------------------------------------- |
| `generateNewUIDs`  | `boolean` | —       | Generate new Study/Series/SOP Instance UIDs |
| `validateDocument` | `boolean` | —       | Validate the SR document                    |

**Result:** `{ outputPath: string }`

---

## drtdump

Dump the contents of a DICOM Radiation Therapy (RT) object as text.

```typescript
import { drtdump } from 'dcmtk';

const result = await drtdump({
    inputPath: '/path/to/rt-plan.dcm',
});

if (result.ok) {
    console.log(result.value.text);
}
```

| Option          | Type      | Default | Description                      |
| --------------- | --------- | ------- | -------------------------------- |
| `printFilename` | `boolean` | —       | Print filename for each document |

**Result:** `{ text: string }`
