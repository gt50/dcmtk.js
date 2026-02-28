/**
 * Example 04: Dcmrecv Server
 *
 * Demonstrates running a DICOM receiver (Dcmrecv) with association tracking.
 * Two senders each transmit multiple files in separate associations. Events
 * show how to correlate received files with their source.
 *
 * Dcmrecv is the simpler DICOM receiver — good for basic C-STORE SCP
 * use cases. A config file is needed to define accepted transfer syntaxes.
 *
 * Run: pnpm tsx examples/04-dcmrecv-server/index.ts
 */
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { Dcmrecv, echoscu, dcmsend, unwrap } from '@ubercode/dcmtk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SAMPLES = resolve(__dirname, '../../dicomSamples/1010_brain_mr_12_jpg');
const CONFIG_FILE = resolve(__dirname, '../../src/data/storescp.cfg');

// Each sender transmits these files within a single DICOM association.
// dcmsend is used because it proposes the file's native transfer syntax.
const SCANNER_FILES = [resolve(SAMPLES, 'IM-0001-0001.dcm'), resolve(SAMPLES, 'IM-0001-0002.dcm')];
const WORKSTATION_FILES = [resolve(SAMPLES, 'IM-0001-0003.dcm'), resolve(SAMPLES, 'IM-0001-0004.dcm')];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Find an available TCP port by binding to port 0. */
async function getAvailablePort(): Promise<number> {
    return new Promise((resolvePort, reject) => {
        const srv = createServer();
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address();
            if (addr === null || typeof addr === 'string') {
                srv.close();
                reject(new Error('Could not determine port'));
                return;
            }
            const port = addr.port;
            srv.close(() => resolvePort(port));
        });
        srv.on('error', reject);
    });
}

/** Tracks files received within a single DICOM association. */
interface AssociationRecord {
    callingAE: string;
    files: string[];
}

async function main() {
    console.log('=== Example 04: Dcmrecv Server ===\n');

    const tempDir = await mkdtemp(join(tmpdir(), 'dcmtk-ex04-'));
    const port = await getAvailablePort();

    // 1. Create Dcmrecv server
    const createResult = Dcmrecv.create({
        port,
        outputDirectory: tempDir,
        aeTitle: 'DCMRECVDEMO',
        configFile: CONFIG_FILE,
        configProfile: 'Default',
    });
    if (!createResult.ok) {
        console.error(`Failed to create Dcmrecv: ${createResult.error.message}`);
        return;
    }
    const server = createResult.value;

    try {
        // -------------------------------------------------------------------
        // 2. Association tracking — correlate received files with their source
        //
        //    dcmrecv logs association details to stderr. We parse raw line
        //    output for boundaries and caller identity, and use the typed
        //    STORED_FILE event for file tracking.
        // -------------------------------------------------------------------
        const associations: AssociationRecord[] = [];
        let current: AssociationRecord | null = null;

        // Parse raw line output for association start/end and calling AE title
        server.on('line', ({ text }: { text: string }) => {
            const assocMatch = /Association Received\s+\S+:\s+(\S+)\s+->/.exec(text);
            if (assocMatch) {
                current = { callingAE: assocMatch[1] ?? 'unknown', files: [] };
                console.log(`  [assoc] << New association from "${current.callingAE}"`);
            }
            if (/Association Release/i.test(text) && current) {
                associations.push(current);
                console.log(`  [assoc] >> Released (${current.files.length} file(s))\n`);
                current = null;
            }
        });

        // Typed event for file tracking — add each file to the current association
        server.onEvent('STORED_FILE', data => {
            if (current) current.files.push(basename(data.filePath));
            console.log(`  [file]  Stored: ${basename(data.filePath)}`);
        });

        // -------------------------------------------------------------------
        // 3. Start server
        // -------------------------------------------------------------------
        console.log(`Starting Dcmrecv on port ${port}...`);
        unwrap(await server.start());
        await sleep(1000);
        console.log('Dcmrecv is listening.\n');

        // -------------------------------------------------------------------
        // 4. C-ECHO verification
        // -------------------------------------------------------------------
        console.log('--- C-ECHO verification ---');
        const echoResult = await echoscu({
            host: '127.0.0.1',
            port,
            calledAETitle: 'DCMRECVDEMO',
            timeoutMs: 10_000,
        });
        console.log(`  ${echoResult.ok ? 'C-ECHO succeeded' : `Failed: ${echoResult.error.message}`}\n`);

        // -------------------------------------------------------------------
        // 5. Two senders, each with its own association and multiple files.
        //    Each dcmsend invocation = one DICOM association = one batch.
        // -------------------------------------------------------------------
        console.log('--- Sender 1: SCANNER (2 MR files) ---');
        const r1 = await dcmsend({
            host: '127.0.0.1',
            port,
            calledAETitle: 'DCMRECVDEMO',
            callingAETitle: 'SCANNER',
            files: SCANNER_FILES,
            timeoutMs: 30_000,
        });
        console.log(`  Result: ${r1.ok ? 'success' : r1.error.message}`);
        await sleep(500);

        console.log('--- Sender 2: WORKSTATION (2 MR files) ---');
        const r2 = await dcmsend({
            host: '127.0.0.1',
            port,
            calledAETitle: 'DCMRECVDEMO',
            callingAETitle: 'WORKSTATION',
            files: WORKSTATION_FILES,
            timeoutMs: 30_000,
        });
        console.log(`  Result: ${r2.ok ? 'success' : r2.error.message}`);
        await sleep(500);

        // -------------------------------------------------------------------
        // 6. Association summary — which files came from which sender
        // -------------------------------------------------------------------
        console.log('--- Association Summary ---');
        for (const [i, assoc] of associations.entries()) {
            if (assoc.files.length === 0) continue;
            console.log(`  #${i + 1} from "${assoc.callingAE}": ${assoc.files.length} file(s)`);
            for (const f of assoc.files) {
                console.log(`       ${f}`);
            }
        }

        const allFiles = await readdir(tempDir);
        console.log(`\n  Total files on disk: ${allFiles.length}`);

        console.log('\nDone.');
    } finally {
        await server.stop();
        await rm(tempDir, { recursive: true, force: true });
        console.log('Server stopped and temp files cleaned up.');
    }
}

main().catch(console.error);
