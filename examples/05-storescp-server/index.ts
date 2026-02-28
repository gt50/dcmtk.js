/**
 * Example 05: StoreSCP Server
 *
 * Demonstrates running a Storage SCP (StoreSCP) with typed event handling,
 * concurrent file sends, and termscu protocol-level shutdown.
 *
 * StoreSCP is the advanced storage SCP with configurable filename
 * generation, subdirectory sorting, and more options than Dcmrecv.
 *
 * Run: pnpm tsx examples/05-storescp-server/index.ts
 */
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { StoreSCP, echoscu, storescu, dcmsend, termscu, unwrap } from '@ubercode/dcmtk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SAMPLE = resolve(__dirname, '../../dicomSamples/other/0002d.DCM');

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Find an available TCP port by binding to port 0. */
async function getAvailablePort() {
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
    console.log('=== Example 05: StoreSCP Server ===\n');

    const tempDir = await mkdtemp(join(tmpdir(), 'dcmtk-ex05-'));
    const port = await getAvailablePort();

    // 1. Create StoreSCP server
    const createResult = StoreSCP.create({
        port,
        outputDirectory: tempDir,
        aeTitle: 'STORESCPDEMO',
    });
    if (!createResult.ok) {
        console.error(`Failed to create StoreSCP: ${createResult.error.message}`);
        return;
    }
    const server = createResult.value;

    try {
        // -------------------------------------------------------------------
        // 2. Wire up typed event handlers
        // -------------------------------------------------------------------
        server.onEvent('ASSOCIATION_RECEIVED', data => {
            console.log(`  [event] Association received from: ${data.callingAETitle}`);
        });
        server.onEvent('STORING_FILE', data => {
            console.log(`  [event] Storing file: ${data.filePath}`);
        });
        server.onEvent('ASSOCIATION_RELEASE', () => {
            console.log('  [event] Association released');
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
        if (echoResult.ok) {
            console.log('  C-ECHO succeeded.\n');
        } else {
            console.log(`  C-ECHO failed: ${echoResult.error.message}\n`);
        }

        // -------------------------------------------------------------------
        // 5. Concurrent sends — storescu and dcmsend simultaneously
        // -------------------------------------------------------------------
        console.log('--- Concurrent file sends ---');
        console.log('  Sending via storescu and dcmsend concurrently...');
        const [storescuResult, dcmsendResult] = await Promise.all([
            storescu({ host: '127.0.0.1', port, files: [SAMPLE], timeoutMs: 30_000 }),
            dcmsend({ host: '127.0.0.1', port, files: [SAMPLE], timeoutMs: 30_000 }),
        ]);
        console.log(`  storescu: ${storescuResult.ok ? 'success' : storescuResult.error.message}`);
        console.log(`  dcmsend:  ${dcmsendResult.ok ? 'success' : dcmsendResult.error.message}`);

        // -------------------------------------------------------------------
        // 6. List received files
        // -------------------------------------------------------------------
        await sleep(2000);
        const files = await readdir(tempDir);
        console.log(`\n--- Received files (${files.length}) ---`);
        for (const f of files) {
            console.log(`  ${f}`);
        }

        // -------------------------------------------------------------------
        // 7. Compare with Dcmrecv
        // -------------------------------------------------------------------
        console.log('\n--- StoreSCP vs Dcmrecv ---');
        console.log('  StoreSCP advantages over Dcmrecv:');
        console.log('  - Configurable filename generation patterns');
        console.log('  - Subdirectory sorting by patient/study/series');
        console.log('  - Config file support for transfer syntax profiles');
        console.log('  - termscu protocol-level shutdown support');

        // -------------------------------------------------------------------
        // 8. Attempt termscu — DICOM protocol-level shutdown
        // -------------------------------------------------------------------
        console.log('\n--- termscu: protocol-level shutdown ---');
        const termResult = await termscu({ host: '127.0.0.1', port, timeoutMs: 5_000 });
        if (termResult.ok) {
            console.log('  Server terminated via termscu protocol message.');
            await sleep(1000);
        } else {
            console.log('  termscu not supported in this configuration, using server.stop().');
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
