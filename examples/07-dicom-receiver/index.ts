/**
 * Example 07: DicomReceiver — Pooled DICOM Receiver with Auto-Scaling
 *
 * Demonstrates running a pooled DICOM receiver (DicomReceiver) that manages
 * multiple dcmrecv workers behind a single TCP port. Incoming connections
 * are routed to idle workers automatically, and workers are reused across
 * associations without restart.
 *
 * Key features shown:
 *   - Auto-scaling worker pool (minPoolSize=2, maxPoolSize=4)
 *   - Per-association file organization in storageDir
 *   - FILE_RECEIVED and ASSOCIATION_COMPLETE events
 *   - Worker reuse (same workers handle multiple rounds of sends)
 *   - Pool status monitoring
 *
 * Run: pnpm tsx examples/07-dicom-receiver/index.ts
 */
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm, readdir } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { DicomReceiver, dcmsend, unwrap } from '@ubercode/dcmtk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SAMPLES = resolve(__dirname, '../../dicomSamples/1010_brain_mr_12_jpg');
const CONFIG_FILE = resolve(__dirname, '../../src/data/storescp.cfg');

const FILES_A = [resolve(SAMPLES, 'IM-0001-0001.dcm'), resolve(SAMPLES, 'IM-0001-0002.dcm')];
const FILES_B = [resolve(SAMPLES, 'IM-0001-0003.dcm'), resolve(SAMPLES, 'IM-0001-0004.dcm')];
const FILES_C = [resolve(SAMPLES, 'IM-0001-0005.dcm'), resolve(SAMPLES, 'IM-0001-0006.dcm')];

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

async function main() {
    console.log('=== Example 07: DicomReceiver — Pooled Receiver ===\n');

    const storageDir = await mkdtemp(`${tmpdir()}/dcmtk-ex07-`);
    const port = await getAvailablePort();

    // 1. Create the pooled receiver
    const receiver = unwrap(
        DicomReceiver.create({
            port,
            storageDir,
            aeTitle: 'POOLRECV',
            minPoolSize: 2,
            maxPoolSize: 4,
            configFile: CONFIG_FILE,
            configProfile: 'Default',
        })
    );

    try {
        // 2. Wire events
        receiver.onFileReceived(data => {
            console.log(`  [file]  ${basename(data.filePath)} → ${data.associationDir} (from "${data.callingAE}")`);
        });

        receiver.onAssociationComplete(data => {
            console.log(`  [assoc] ${data.associationId} complete: ${data.files.length} file(s), ${data.durationMs}ms, reason=${data.endReason}`);
        });

        // 3. Start
        console.log(`Starting DicomReceiver on port ${port} (pool: 2–4 workers)...`);
        unwrap(await receiver.start());
        await sleep(2000);
        console.log(`Pool status: ${JSON.stringify(receiver.poolStatus)}\n`);

        // 4. Round 1 — two concurrent senders
        console.log('--- Round 1: Two concurrent senders ---');
        const [r1, r2] = await Promise.all([
            dcmsend({
                host: '127.0.0.1',
                port,
                callingAETitle: 'SCANNER_A',
                calledAETitle: 'POOLRECV',
                files: FILES_A,
                timeoutMs: 30_000,
            }),
            dcmsend({
                host: '127.0.0.1',
                port,
                callingAETitle: 'SCANNER_B',
                calledAETitle: 'POOLRECV',
                files: FILES_B,
                timeoutMs: 30_000,
            }),
        ]);
        console.log(`  Sender A: ${r1.ok ? 'success' : r1.error.message}`);
        console.log(`  Sender B: ${r2.ok ? 'success' : r2.error.message}`);
        await sleep(2000);
        console.log(`  Pool status: ${JSON.stringify(receiver.poolStatus)}\n`);

        // 5. Round 2 — reuse workers (no restart)
        console.log('--- Round 2: Third sender (workers reused) ---');
        const r3 = await dcmsend({
            host: '127.0.0.1',
            port,
            callingAETitle: 'WORKSTATION',
            calledAETitle: 'POOLRECV',
            files: FILES_C,
            timeoutMs: 30_000,
        });
        console.log(`  Sender C: ${r3.ok ? 'success' : r3.error.message}`);
        await sleep(2000);
        console.log(`  Pool status: ${JSON.stringify(receiver.poolStatus)}\n`);

        // 6. Show association directories
        console.log('--- Storage Directory Contents ---');
        const entries = await readdir(storageDir);
        for (const entry of entries) {
            const files = await readdir(resolve(storageDir, entry));
            console.log(`  ${entry}/ → ${files.length} file(s): ${files.join(', ')}`);
        }

        console.log('\nDone.');
    } finally {
        await receiver.stop();
        await rm(storageDir, { recursive: true, force: true });
        console.log('Receiver stopped and temp files cleaned up.');
    }
}

main().catch(console.error);
