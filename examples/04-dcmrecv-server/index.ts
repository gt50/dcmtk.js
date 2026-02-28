/**
 * Example 04: Dcmrecv Server
 *
 * Demonstrates running a DICOM receiver (Dcmrecv) with typed event handling
 * and concurrent file sends via storescu and dcmsend.
 *
 * Dcmrecv is the simpler DICOM receiver — good for basic C-STORE SCP
 * use cases. A config file is needed to define accepted transfer syntaxes.
 *
 * Run: pnpm tsx examples/04-dcmrecv-server/index.ts
 */
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { Dcmrecv, echoscu, storescu, dcmsend, unwrap } from '@ubercode/dcmtk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SAMPLE = resolve(__dirname, '../../dicomSamples/other/0002d.DCM');
const CONFIG_FILE = resolve(__dirname, '../../src/data/storescp.cfg');

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
        // 2. Wire up typed event handlers
        // -------------------------------------------------------------------
        server.onEvent('ASSOCIATION_RECEIVED', data => {
            console.log(`  [event] Association received from: ${data.callingAETitle}`);
        });
        server.onEvent('C_STORE_REQUEST', data => {
            console.log(`  [event] C-STORE request: ${data.sopClassUID}`);
        });
        server.onEvent('STORED_FILE', data => {
            console.log(`  [event] File stored: ${data.filePath}`);
        });
        server.onEvent('ASSOCIATION_RELEASE', () => {
            console.log('  [event] Association released');
        });

        // -------------------------------------------------------------------
        // 3. Start server
        // -------------------------------------------------------------------
        console.log(`Starting Dcmrecv on port ${port}...`);
        unwrap(await server.start());
        await sleep(1000);
        console.log('Dcmrecv is listening.\n');

        // -------------------------------------------------------------------
        // 4. Verify connectivity with C-ECHO
        // -------------------------------------------------------------------
        console.log('--- C-ECHO verification ---');
        const echoResult = await echoscu({ host: '127.0.0.1', port, calledAETitle: 'DCMRECVDEMO', timeoutMs: 10_000 });
        if (echoResult.ok) {
            console.log('  C-ECHO succeeded — server is reachable.\n');
        } else {
            console.log(`  C-ECHO failed: ${echoResult.error.message}\n`);
        }

        // -------------------------------------------------------------------
        // 5. Concurrent sends — storescu and dcmsend simultaneously
        // -------------------------------------------------------------------
        console.log('--- Concurrent file sends ---');
        console.log('  Sending 1 file via storescu and 1 via dcmsend concurrently...');
        const [storescuResult, dcmsendResult] = await Promise.all([
            storescu({ host: '127.0.0.1', port, calledAETitle: 'DCMRECVDEMO', files: [SAMPLE], timeoutMs: 30_000 }),
            dcmsend({ host: '127.0.0.1', port, calledAETitle: 'DCMRECVDEMO', files: [SAMPLE], timeoutMs: 30_000 }),
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

        console.log('\nDone.');
    } finally {
        await server.stop();
        await rm(tempDir, { recursive: true, force: true });
        console.log('Server stopped and temp files cleaned up.');
    }
}

main().catch(console.error);
