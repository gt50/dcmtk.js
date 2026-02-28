/**
 * Example 05: StoreSCP Server
 *
 * Demonstrates running a Storage SCP (StoreSCP) with association tracking,
 * concurrent multi-file sends from different senders, and termscu shutdown.
 *
 * StoreSCP is the advanced storage SCP with configurable filename
 * generation, subdirectory sorting, and more options than Dcmrecv.
 *
 * Run: pnpm tsx examples/05-storescp-server/index.ts
 */
import { resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { StoreSCP, echoscu, dcmsend, termscu, unwrap } from '@ubercode/dcmtk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SAMPLES = resolve(__dirname, '../../dicomSamples/1010_brain_mr_12_jpg');
const CONFIG_FILE = resolve(__dirname, '../../src/data/storescp.cfg');

// Each sender transmits these files within a single DICOM association.
const MODALITY_FILES = [resolve(SAMPLES, 'IM-0001-0001.dcm'), resolve(SAMPLES, 'IM-0001-0002.dcm')];
const GATEWAY_FILES = [resolve(SAMPLES, 'IM-0001-0003.dcm'), resolve(SAMPLES, 'IM-0001-0004.dcm')];

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
    label: string;
    files: string[];
}

async function main() {
    console.log('=== Example 05: StoreSCP Server ===\n');

    const tempDir = await mkdtemp(join(tmpdir(), 'dcmtk-ex05-'));
    const port = await getAvailablePort();

    // 1. Create StoreSCP server with config for compressed transfer syntaxes
    const createResult = StoreSCP.create({
        port,
        outputDirectory: tempDir,
        aeTitle: 'STORESCPDEMO',
        configFile: CONFIG_FILE,
        configProfile: 'Default',
    });
    if (!createResult.ok) {
        console.error(`Failed to create StoreSCP: ${createResult.error.message}`);
        return;
    }
    const server = createResult.value;

    try {
        // -------------------------------------------------------------------
        // 2. Association tracking
        //
        //    storescp logs "Association Received" / "Association Release" for
        //    each association. We parse raw line output for boundaries and
        //    use the typed STORING_FILE event for file tracking.
        // -------------------------------------------------------------------
        const associations: AssociationRecord[] = [];
        let current: AssociationRecord | null = null;
        let associationCount = 0;

        // Parse raw line output for association boundaries
        server.on('line', ({ text }: { text: string }) => {
            if (/Association Received/i.test(text) && !current) {
                associationCount++;
                current = { label: `Association #${associationCount}`, files: [] };
                console.log(`  [assoc] << ${current.label} started`);
            }
            if (/Association Release/i.test(text) && current) {
                associations.push(current);
                console.log(`  [assoc] >> ${current.label} released (${current.files.length} file(s))\n`);
                current = null;
            }
        });

        // Typed event for file tracking — correlate with current association
        server.onEvent('STORING_FILE', data => {
            if (current) current.files.push(basename(data.filePath));
            console.log(`  [file]  Storing: ${basename(data.filePath)}`);
        });

        // -------------------------------------------------------------------
        // 3. Start server
        // -------------------------------------------------------------------
        console.log(`Starting StoreSCP on port ${port}...`);
        unwrap(await server.start());
        await sleep(1000);
        console.log('StoreSCP is listening.\n');

        // -------------------------------------------------------------------
        // 4. C-ECHO verification
        // -------------------------------------------------------------------
        console.log('--- C-ECHO verification ---');
        const echoResult = await echoscu({ host: '127.0.0.1', port, timeoutMs: 10_000 });
        console.log(`  ${echoResult.ok ? 'C-ECHO succeeded' : `Failed: ${echoResult.error.message}`}\n`);

        // -------------------------------------------------------------------
        // 5. Concurrent sends — two senders transmit simultaneously.
        //    StoreSCP handles one association at a time, so they queue up.
        //    From the caller's perspective both are in-flight concurrently.
        // -------------------------------------------------------------------
        console.log('--- Concurrent sends: MODALITY + GATEWAY (2 files each) ---');
        const [r1, r2] = await Promise.all([
            dcmsend({
                host: '127.0.0.1',
                port,
                callingAETitle: 'MODALITY',
                files: MODALITY_FILES,
                timeoutMs: 30_000,
            }),
            dcmsend({
                host: '127.0.0.1',
                port,
                callingAETitle: 'GATEWAY',
                files: GATEWAY_FILES,
                timeoutMs: 30_000,
            }),
        ]);
        console.log(`  dcmsend (MODALITY): ${r1.ok ? 'success' : r1.error.message}`);
        console.log(`  dcmsend (GATEWAY):  ${r2.ok ? 'success' : r2.error.message}`);
        await sleep(1000);

        // -------------------------------------------------------------------
        // 6. Association summary
        // -------------------------------------------------------------------
        console.log('--- Association Summary ---');
        for (const assoc of associations) {
            if (assoc.files.length === 0) continue;
            console.log(`  ${assoc.label}: ${assoc.files.length} file(s)`);
            for (const f of assoc.files) {
                console.log(`       ${f}`);
            }
        }

        const allFiles = await readdir(tempDir);
        console.log(`\n  Total files on disk: ${allFiles.length}`);

        // -------------------------------------------------------------------
        // 7. StoreSCP vs Dcmrecv
        // -------------------------------------------------------------------
        console.log('\n--- StoreSCP vs Dcmrecv ---');
        console.log('  StoreSCP advantages:');
        console.log('  - Configurable filename generation patterns');
        console.log('  - Subdirectory sorting by patient/study/series');
        console.log('  - Config file support for transfer syntax profiles');
        console.log('  - termscu protocol-level shutdown support');

        // -------------------------------------------------------------------
        // 8. termscu — DICOM protocol-level shutdown
        // -------------------------------------------------------------------
        console.log('\n--- termscu: protocol-level shutdown ---');
        const termResult = await termscu({ host: '127.0.0.1', port, timeoutMs: 5_000 });
        if (termResult.ok) {
            console.log('  Server terminated via termscu.');
            await sleep(1000);
        } else {
            console.log('  termscu not supported in this config, using server.stop().');
            await server.stop();
        }

        console.log('\nDone.');
    } finally {
        try {
            await server.stop();
        } catch {
            /* already stopped via termscu */
        }
        await rm(tempDir, { recursive: true, force: true });
        console.log('Server stopped and temp files cleaned up.');
    }
}

main().catch(console.error);
