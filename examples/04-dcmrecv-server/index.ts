/**
 * Example 04: Dcmrecv Server
 *
 * Demonstrates running a DICOM receiver (Dcmrecv) with built-in association
 * tracking. Two senders each transmit multiple files in separate associations.
 * The server's AssociationTracker automatically correlates received files
 * with their source — no manual line parsing needed.
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

/** Collected association summaries for final report. */
interface AssociationRecord {
    associationId: string;
    callingAE: string;
    files: readonly string[];
    durationMs: number;
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
        // 2. Association tracking via built-in AssociationTracker
        //
        //    The server automatically correlates files to associations using
        //    an internal state machine. Two high-level events provide all the
        //    context you need — no manual line parsing required.
        //
        //    - FILE_RECEIVED: each file enriched with association context
        //    - ASSOCIATION_COMPLETE: summary with all files when association ends
        // -------------------------------------------------------------------
        const associations: AssociationRecord[] = [];

        // Each file arrives enriched with its association context
        server.onFileReceived(data => {
            console.log(`  [file]  ${basename(data.filePath)} (${data.associationId} from "${data.callingAE}")`);
        });

        // Summary fires when each association ends — includes the full file list
        server.onAssociationComplete(summary => {
            associations.push({
                associationId: summary.associationId,
                callingAE: summary.callingAE,
                files: summary.files,
                durationMs: summary.durationMs,
            });
            console.log(`  [assoc] ${summary.associationId} complete: ${summary.files.length} file(s) in ${summary.durationMs}ms\n`);
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
        for (const assoc of associations) {
            if (assoc.files.length === 0) continue;
            console.log(`  ${assoc.associationId} from "${assoc.callingAE}": ${assoc.files.length} file(s)`);
            for (const f of assoc.files) {
                console.log(`       ${basename(f)}`);
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
