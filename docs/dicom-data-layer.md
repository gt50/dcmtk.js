# DICOM Data Layer

The library provides an immutable data layer for reading, querying, and modifying DICOM files. It consists of three main classes: `DicomDataset`, `ChangeSet`, and `DicomInstance`.

## DicomDataset

Immutable wrapper around a DICOM JSON Model (PS3.18 F.2) with type-safe accessors.

### Creating a Dataset

```typescript
import { DicomDataset, dcm2json, unwrap } from '@ubercode/dcmtk';

// From a DICOM JSON Model object
const ds = unwrap(DicomDataset.fromJson(jsonObject));

// From a file (via dcm2json)
const result = await dcm2json('/path/to/image.dcm');
if (result.ok) {
    const dataset = unwrap(DicomDataset.fromJson(result.value.data));
}
```

### Convenience Getters

Common tags are available as properties:

| Getter              | Tag           | Return Type |
| ------------------- | ------------- | ----------- |
| `patientName`       | `(0010,0010)` | `string`    |
| `patientID`         | `(0010,0020)` | `string`    |
| `studyDate`         | `(0008,0020)` | `string`    |
| `modality`          | `(0008,0060)` | `string`    |
| `accession`         | `(0008,0050)` | `string`    |
| `sopClassUID`       | `(0008,0016)` | `string`    |
| `studyInstanceUID`  | `(0020,000D)` | `string`    |
| `seriesInstanceUID` | `(0020,000E)` | `string`    |
| `sopInstanceUID`    | `(0008,0018)` | `string`    |
| `transferSyntaxUID` | `(0002,0010)` | `string`    |

```typescript
console.log(ds.patientName); // 'DOE^JOHN'
console.log(ds.studyDate); // '20240115'
console.log(ds.modality); // 'CT'
```

### Generic Accessors

| Method                      | Return                      | Description                    |
| --------------------------- | --------------------------- | ------------------------------ |
| `getString(tag, fallback?)` | `string`                    | Get first value as string      |
| `getNumber(tag)`            | `Result<number>`            | Get first value as number      |
| `getStrings(tag)`           | `Result<readonly string[]>` | Get all values as strings      |
| `hasTag(tag)`               | `boolean`                   | Check if tag exists            |
| `getElementAtPath(path)`    | `Result<DicomJsonElement>`  | Traverse into nested sequences |
| `findValues(wildcardPath)`  | `readonly unknown[]`        | Search with wildcard paths     |

```typescript
// String accessor with fallback
const patientId = ds.getString('00100020', 'UNKNOWN');

// Number accessor (returns Result)
const instanceNumber = ds.getNumber('00200013');
if (instanceNumber.ok) {
    console.log(`Instance #${instanceNumber.value}`);
}

// Multi-value accessor
const imageTypes = ds.getStrings('00080008');
if (imageTypes.ok) {
    console.log('Image types:', imageTypes.value.join(', '));
}

// Tag path traversal into sequences
const path = createDicomTagPath('(0040,A730)[0].(0040,A160)');
const element = ds.getElementAtPath(path);

// Wildcard search across all items
const values = ds.findValues('(0040,A730).*.0040,A160');
```

---

## ChangeSet

Immutable builder for tracking DICOM tag modifications. Every mutation returns a new `ChangeSet` instance — the original is never modified.

### Building Changes

```typescript
import { ChangeSet, createDicomTagPath } from '@ubercode/dcmtk';

const changes = ChangeSet.empty()
    .setTag(createDicomTagPath('(0010,0010)'), 'DOE^JOHN')
    .setTag(createDicomTagPath('(0010,0020)'), 'PAT-001')
    .eraseTag(createDicomTagPath('(0010,0030)')) // erase birth date
    .erasePrivateTags(); // erase all private tags
```

### API

| Method                 | Return              | Description                                |
| ---------------------- | ------------------- | ------------------------------------------ |
| `ChangeSet.empty()`    | `ChangeSet`         | Create an empty changeset                  |
| `.setTag(path, value)` | `ChangeSet`         | Set a tag value (returns new instance)     |
| `.eraseTag(path)`      | `ChangeSet`         | Mark a tag for erasure                     |
| `.erasePrivateTags()`  | `ChangeSet`         | Mark all private tags for erasure          |
| `.merge(other)`        | `ChangeSet`         | Merge with another changeset               |
| `.isEmpty`             | `boolean`           | Whether no modifications or erasures exist |
| `.modifications`       | `ReadonlyMap`       | All pending set operations                 |
| `.erasures`            | `ReadonlySet`       | All pending erase operations               |
| `.toModifications()`   | `TagModification[]` | Convert to dcmodify-compatible format      |

### Merging ChangeSets

```typescript
const patientChanges = ChangeSet.empty().setTag(createDicomTagPath('(0010,0010)'), 'ANONYMOUS').setTag(createDicomTagPath('(0010,0020)'), 'ANON-001');

const privacyChanges = ChangeSet.empty().eraseTag(createDicomTagPath('(0010,0030)')).erasePrivateTags();

const combined = patientChanges.merge(privacyChanges);
```

---

## DicomInstance

Unified DICOM object composing `DicomDataset`, `ChangeSet`, file path, and application metadata. Every setter returns a new immutable instance.

### Opening a File

```typescript
import { DicomInstance } from '@ubercode/dcmtk';

const result = await DicomInstance.open('/path/to/image.dcm');
if (result.ok) {
    const inst = result.value;
    console.log(inst.patientName);
    console.log(inst.filePath);
}
```

### Creating from a Dataset

```typescript
const ds = unwrap(DicomDataset.fromJson(jsonObject));
const inst = unwrap(DicomInstance.fromDataset(ds, '/path/to/image.dcm'));
```

### Properties

| Property            | Type                  | Description                        |
| ------------------- | --------------------- | ---------------------------------- |
| `dataset`           | `DicomDataset`        | Immutable parsed dataset           |
| `filePath`          | `string \| undefined` | File path (undefined if in-memory) |
| `changes`           | `ChangeSet`           | Accumulated pending changes        |
| `hasUnsavedChanges` | `boolean`             | Whether there are pending changes  |
| `patientName`       | `string`              | Convenience getter for (0010,0010) |
| `patientID`         | `string`              | Convenience getter for (0010,0020) |
| `modality`          | `string`              | Convenience getter for (0008,0060) |
| `studyDate`         | `string`              | Convenience getter for (0008,0020) |

### Modifying Tags (Fluent API)

```typescript
const inst = unwrap(await DicomInstance.open('/path/to/image.dcm'));

const modified = inst.setPatientName('ANONYMOUS').setPatientID('ANON-001').erasePrivateTags();

// Option A: Modify in-place
await modified.applyChanges();

// Option B: Write to a new file (original untouched)
await modified.writeAs('/path/to/anonymized.dcm');
```

### Using withChanges for Bulk Changes

```typescript
const changes = ChangeSet.empty().setTag(createDicomTagPath('(0010,0010)'), 'ANONYMOUS').erasePrivateTags();

const updated = inst.withChanges(changes);
await updated.applyChanges();
```

### API

| Method                                 | Return                           | Description                           |
| -------------------------------------- | -------------------------------- | ------------------------------------- |
| `DicomInstance.open(path, options?)`   | `Promise<Result<DicomInstance>>` | Open and parse a DICOM file           |
| `DicomInstance.fromDataset(ds, path?)` | `Result<DicomInstance>`          | Create from an existing dataset       |
| `.setTag(path, value)`                 | `DicomInstance`                  | Set a tag value                       |
| `.eraseTag(path)`                      | `DicomInstance`                  | Erase a tag                           |
| `.erasePrivateTags()`                  | `DicomInstance`                  | Erase all private tags                |
| `.setPatientName(value)`               | `DicomInstance`                  | Set Patient Name                      |
| `.setBatch(entries)`                   | `DicomInstance`                  | Set multiple tags at once             |
| `.withChanges(changes)`                | `DicomInstance`                  | Merge an external ChangeSet           |
| `.withFilePath(path)`                  | `DicomInstance`                  | Return instance with different path   |
| `.withMetadata(key, value)`            | `DicomInstance`                  | Attach application metadata           |
| `.applyChanges(options?)`              | `Promise<Result<void>>`          | Apply changes in-place via dcmodify   |
| `.writeAs(path, options?)`             | `Promise<Result<DicomInstance>>` | Copy file, then apply changes to copy |
| `.fileSize()`                          | `Promise<Result<number>>`        | Get file size in bytes                |
| `.unlink()`                            | `Promise<Result<void>>`          | Delete the file                       |

### Full Example

```typescript
import { DicomInstance, unwrap } from '@ubercode/dcmtk';

// Open and inspect
const inst = unwrap(await DicomInstance.open('/path/to/image.dcm'));
console.log('Patient:', inst.patientName);
console.log('Study:', inst.studyDate);
console.log('Size:', unwrap(await inst.fileSize()), 'bytes');

// Anonymize to a new file
const anonymized = inst.setPatientName('ANONYMOUS').setPatientID('ANON-001').erasePrivateTags();

const writeResult = await anonymized.writeAs('/path/to/anon.dcm');
if (writeResult.ok) {
    console.log('Anonymized copy created');
}
```

---

## Supporting Utilities

### Dictionary Lookups

```typescript
import { lookupTag, lookupTagByName, lookupTagByKeyword } from '@ubercode/dcmtk';

lookupTag('00100010'); // { name: 'Patient\'s Name', keyword: 'PatientName', vr: 'PN' }
lookupTagByName("Patient's Name"); // { tag: '00100010', ... }
lookupTagByKeyword('PatientName'); // { tag: '00100010', ... }
```

### SOP Class Mappings

```typescript
import { sopClassNameFromUID, SOP_CLASSES } from '@ubercode/dcmtk';

sopClassNameFromUID('1.2.840.10008.5.1.4.1.1.2'); // 'CT Image Storage'
```

### Value Representations

```typescript
import { VR } from '@ubercode/dcmtk';

VR.PN; // { code: 'PN', name: 'Person Name', maxLength: 64, ... }
VR.DA; // { code: 'DA', name: 'Date', maxLength: 8, ... }
```

The `VR` object contains metadata for all 34 standard DICOM Value Representations.
