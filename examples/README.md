# @ubercode/dcmtk Examples

Runnable examples demonstrating common DCMTK workflows with the `@ubercode/dcmtk` library.

## Prerequisites

- **Node.js** >= 20
- **pnpm** (package manager)
- **DCMTK** installed and available via `DCMTK_PATH` environment variable or in a standard install location

## Setup

From the repository root:

```bash
pnpm install
pnpm run build
```

## Running Examples

Each example is a standalone TypeScript file. Run with `tsx`:

```bash
# Inspect DICOM files (dcm2xml, dcm2json, dcmdump, DicomDataset)
pnpm tsx examples/01-inspect-dicom/index.ts

# Modify and convert DICOM files (dcmodify, dcmconv, ChangeSet, DicomInstance)
pnpm tsx examples/02-modify-and-convert/index.ts

# Structured Reports (xml2dsr, dsrdump, dsr2xml)
pnpm tsx examples/03-structured-reports/index.ts

# Dcmrecv server with concurrent file receives
pnpm tsx examples/04-dcmrecv-server/index.ts

# StoreSCP server with concurrent receives and termscu shutdown
pnpm tsx examples/05-storescp-server/index.ts

# Full Query/Retrieve workflow (DcmQRSCP, findscu, getscu, movescu, PacsClient)
pnpm tsx examples/06-query-retrieve/index.ts

# Pooled DICOM receiver with auto-scaling workers
pnpm tsx examples/07-dicom-receiver/index.ts
```

## Example Descriptions

| Example                 | Tools / APIs                                             | Description                                     |
| ----------------------- | -------------------------------------------------------- | ----------------------------------------------- |
| `01-inspect-dicom`      | dcm2xml, dcm2json, dcmdump, DicomDataset                 | Read and inspect DICOM file metadata            |
| `02-modify-and-convert` | dcmodify, dcmconv, ChangeSet, DicomInstance              | Modify tags and convert transfer syntax         |
| `03-structured-reports` | xml2dsr, dsrdump, dsr2xml                                | Create, dump, and round-trip structured reports |
| `04-dcmrecv-server`     | Dcmrecv, echoscu, storescu, dcmsend                      | Simple DICOM receiver with concurrent sends     |
| `05-storescp-server`    | StoreSCP, echoscu, storescu, dcmsend, termscu            | Advanced storage SCP with protocol shutdown     |
| `06-query-retrieve`     | DcmQRSCP, dcmqridx, findscu, getscu, movescu, PacsClient | Full PACS query/retrieve workflow               |
| `07-dicom-receiver`     | DicomReceiver, dcmsend                                   | Pooled receiver with auto-scaling workers       |

## Notes

- Examples use sample DICOM files from the `dicomSamples/` directory in the repository root.
- Server examples (04-07) use dynamic port allocation to avoid conflicts.
- All temporary files are cleaned up automatically.
- In your own projects, install the library with `npm install @ubercode/dcmtk` and import from `@ubercode/dcmtk` (or sub-paths like `@ubercode/dcmtk/tools`, `@ubercode/dcmtk/servers`, `@ubercode/dcmtk/dicom`).
