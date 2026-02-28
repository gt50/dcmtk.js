# @ubercode/dcmtk

> **ALPHA PREVIEW RELEASE** — This library has not been thoroughly tested by humans. Use in production at your own risk.

[![npm version](https://img.shields.io/npm/v/@ubercode/dcmtk.svg)](https://www.npmjs.com/package/@ubercode/dcmtk)
[![npm downloads](https://img.shields.io/npm/dm/@ubercode/dcmtk.svg)](https://www.npmjs.com/package/@ubercode/dcmtk)
[![CI](https://github.com/MichaelLeeHobbs/dcmtk.js/actions/workflows/ci.yml/badge.svg)](https://github.com/MichaelLeeHobbs/dcmtk.js/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-green.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

Type-safe Node.js bindings for the [DCMTK](https://dicom.offis.de/dcmtk.php.en) (DICOM Toolkit) command-line utilities. Wraps 51 DCMTK binaries and 6 long-lived server processes with a modern async/await API, branded types, and the Result pattern for safe error handling.

## Features

- **51 tool wrappers** — async functions for every DCMTK command-line binary (data conversion, network, image processing, structured reports, presentation state)
- **6 server classes** — long-lived DICOM listeners with typed EventEmitter APIs and graceful shutdown
- **PacsClient** — high-level PACS client with Echo, Query, Retrieve, and Store operations
- **DICOM data layer** — immutable `DicomDataset`, explicit `ChangeSet` builder, and `DicomInstance` unified file I/O
- **Result pattern** — all fallible operations return `Result<T>` instead of throwing
- **Branded types** — `DicomTag`, `AETitle`, `Port`, and more prevent primitive-type mix-ups at compile time
- **Full TypeScript** — strict mode, dual CJS/ESM build, complete `.d.ts` declarations
- **AbortSignal support** — cancel any operation with standard `AbortController`
- **Zero native dependencies** — delegates to system-installed DCMTK binaries

## Prerequisites

- **Node.js** >= 20
- **DCMTK** installed on the system — set the `DCMTK_PATH` environment variable or install to a standard location (`/usr/bin`, `/usr/local/bin`, `C:\Program Files\DCMTK`)

## Installation

```bash
npm install @ubercode/dcmtk
# or
pnpm add @ubercode/dcmtk
# or
yarn add @ubercode/dcmtk
```

## Quick Start

### Read DICOM metadata

```typescript
import { dcm2json } from '@ubercode/dcmtk';

const result = await dcm2json('/path/to/image.dcm');

if (result.ok) {
    console.log(result.value.data); // DICOM JSON Model object
} else {
    console.error(result.error);
}
```

### Network C-ECHO

```typescript
import { echoscu } from '@ubercode/dcmtk';

const result = await echoscu({
    host: '127.0.0.1',
    port: 4242,
    calledAETitle: 'PACS',
});

if (result.ok) {
    console.log('PACS is reachable');
}
```

### Receive DICOM files

```typescript
import { Dcmrecv } from '@ubercode/dcmtk';

const result = Dcmrecv.create({ port: 4242, outputDirectory: './incoming' });

if (result.ok) {
    const server = result.value;

    server.onEvent('C_STORE_REQUEST', data => {
        console.log(`Receiving: ${data.sopClassUID}`);
    });

    server.onEvent('STORED_FILE', data => {
        console.log(`Saved: ${data.filename}`);
    });

    await server.start();
}
```

## Documentation

| Guide                                        | Description                                              |
| -------------------------------------------- | -------------------------------------------------------- |
| [Getting Started](docs/GETTING_STARTED.md)   | Installation, DICOM glossary, tutorials, troubleshooting |
| [Core Concepts](docs/core-concepts.md)       | Result pattern, branded types, timeouts, AbortSignal     |
| [PACS Client](docs/pacs-client.md)           | High-level Echo, Query, Retrieve, Store API              |
| [DICOM Data Layer](docs/dicom-data-layer.md) | DicomDataset, ChangeSet, DicomInstance                   |
| [Servers](docs/servers.md)                   | 6 long-lived server classes with typed events            |
| [Utilities](docs/utilities.md)               | batch processing, retry with backoff                     |

## Tool Reference

51 async functions wrapping DCMTK command-line binaries, organized by category:

| Category           | Tools                                                                                 | Docs                                                      |
| ------------------ | ------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Data & Metadata    | dcm2xml, dcm2json, dcmdump, dcmconv, dcmodify, dcmftest, dcmgpdir, dcmmkdir, dcmqridx | [data-metadata.md](docs/tools/data-metadata.md)           |
| File Conversion    | xml2dcm, json2dcm, dump2dcm, img2dcm, pdf2dcm, dcm2pdf, cda2dcm, dcm2cda, stl2dcm     | [file-conversion.md](docs/tools/file-conversion.md)       |
| Compression        | dcmcrle, dcmdrle, dcmencap, dcmdecap, dcmcjpeg, dcmdjpeg, dcmcjpls, dcmdjpls          | [compression.md](docs/tools/compression.md)               |
| Image Processing   | dcmj2pnm, dcm2pnm, dcmscale, dcmquant, dcmdspfn, dcod2lum, dconvlum                   | [image-processing.md](docs/tools/image-processing.md)     |
| Network            | echoscu, dcmsend, storescu, findscu, movescu, getscu, termscu                         | [network.md](docs/tools/network.md)                       |
| Structured Reports | dsrdump, dsr2xml, xml2dsr, drtdump                                                    | [structured-reports.md](docs/tools/structured-reports.md) |
| Presentation State | dcmpsmk, dcmpschk, dcmprscu, dcmpsprt, dcmp2pgm, dcmmkcrv, dcmmklut                   | [presentation-state.md](docs/tools/presentation-state.md) |

## Server Reference

| Class      | Binary   | Description                                | Docs                                   |
| ---------- | -------- | ------------------------------------------ | -------------------------------------- |
| `Dcmrecv`  | dcmrecv  | DICOM receiver (C-STORE SCP)               | [servers.md](docs/servers.md#dcmrecv)  |
| `StoreSCP` | storescp | Storage SCP with advanced options          | [servers.md](docs/servers.md#storescp) |
| `DcmQRSCP` | dcmqrscp | Query/Retrieve SCP (C-FIND, C-MOVE, C-GET) | [servers.md](docs/servers.md#dcmqrscp) |
| `Wlmscpfs` | wlmscpfs | Worklist Management SCP                    | [servers.md](docs/servers.md#wlmscpfs) |
| `DcmprsCP` | dcmprscp | Print Management SCP                       | [servers.md](docs/servers.md#dcmprscp) |
| `Dcmpsrcv` | dcmpsrcv | Viewer network receiver                    | [servers.md](docs/servers.md#dcmpsrcv) |

## License

[MIT](LICENSE) - Michael Hobbs
