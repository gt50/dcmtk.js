/**
 * Example 05: StoreSCP Server
 *
 * Demonstrates running a Storage SCP (StoreSCP) with built-in association
 * tracking under realistic concurrent load. Four senders each transmit
 * batches of files simultaneously — the server queues associations and
 * the AssociationTracker reliably correlates every file to its association.
 *
 * StoreSCP is the advanced storage SCP with configurable filename
 * generation, subdirectory sorting, and more options than Dcmrecv.
 *
 * Note: storescp's verbose output does not include calling AE titles
 * (unlike dcmrecv), so association summaries show empty callingAE fields.
 * Use dcmrecv (Example 04) if you need to identify senders by AE title.
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

/** Build file paths for IM-0001-NNNN.dcm in the given range. */
function sampleRange(start: number, end: number): string[] {
    const files: string[] = [];
    for (let i = start; i <= end; i++) {
        files.push(resolve(SAMPLES, `IM-0001-${String(i).padStart(4, '0')}.dcm`));
    }
    return files;
}

// Four senders, each with a distinct batch of files (no overlap).
// Total: 40 files across 4 concurrent associations.
const SENDER_A_FILES = sampleRange(1, 10); // 10 files
const SENDER_B_FILES = sampleRange(11, 20); // 10 files
const SENDER_C_FILES = sampleRange(21, 30); // 10 files
const SENDER_D_FILES = sampleRange(31, 40); // 10 files

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
    files: readonly string[];
    durationMs: number;
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
        // 2. Association tracking via built-in AssociationTracker
        //
        //    The server automatically correlates files to associations using
        //    an internal state machine. No manual line parsing needed.
        //
        //    - FILE_RECEIVED: each file enriched with association context
        //    - ASSOCIATION_COMPLETE: summary with all files when association ends
        //
        //    Why is this safe? dcmrecv and storescp are single-threaded,
        //    single-association servers. They handle one association at a
        //    time — concurrent senders queue at the TCP level. Events are
        //    always strictly sequential: RECEIVED → FILES → RELEASE.
        // -------------------------------------------------------------------
        const associations: AssociationRecord[] = [];
        let totalFilesTracked = 0;

        // Each file arrives enriched with its association context
        server.onFileReceived(data => {
            totalFilesTracked++;
            console.log(`  [file]  ${basename(data.filePath)} (${data.associationId})`);
        });

        // Summary fires when each association ends — includes the full file list
        server.onAssociationComplete(summary => {
            associations.push({
                associationId: summary.associationId,
                files: summary.files,
                durationMs: summary.durationMs,
            });
            console.log(`  [assoc] ${summary.associationId} complete: ${summary.files.length} file(s) in ${summary.durationMs}ms (${summary.endReason})\n`);
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
        // 5. Concurrent sends — four senders transmit simultaneously.
        //    StoreSCP handles one association at a time, so they queue up.
        //    From the caller's perspective all four are in-flight concurrently.
        //    This proves the tracker correctly serializes associations even
        //    under heavy concurrent load.
        // -------------------------------------------------------------------
        console.log('--- Concurrent sends: 4 senders x 10 files = 40 files ---');
        const [rA, rB, rC, rD] = await Promise.all([
            dcmsend({ host: '127.0.0.1', port, callingAETitle: 'SENDERA', files: SENDER_A_FILES, timeoutMs: 60_000 }),
            dcmsend({ host: '127.0.0.1', port, callingAETitle: 'SENDERB', files: SENDER_B_FILES, timeoutMs: 60_000 }),
            dcmsend({ host: '127.0.0.1', port, callingAETitle: 'SENDERC', files: SENDER_C_FILES, timeoutMs: 60_000 }),
            dcmsend({ host: '127.0.0.1', port, callingAETitle: 'SENDERD', files: SENDER_D_FILES, timeoutMs: 60_000 }),
        ]);
        console.log(`  Sender A: ${rA.ok ? 'success' : rA.error.message}`);
        console.log(`  Sender B: ${rB.ok ? 'success' : rB.error.message}`);
        console.log(`  Sender C: ${rC.ok ? 'success' : rC.error.message}`);
        console.log(`  Sender D: ${rD.ok ? 'success' : rD.error.message}`);
        await sleep(1000);

        // -------------------------------------------------------------------
        // 6. Association summary + correctness verification
        // -------------------------------------------------------------------
        console.log('--- Association Summary ---');
        const fileAssociations = associations.filter(a => a.files.length > 0);
        for (const assoc of fileAssociations) {
            console.log(`  ${assoc.associationId}: ${assoc.files.length} file(s) in ${assoc.durationMs}ms`);
            for (const f of assoc.files) {
                console.log(`       ${basename(f)}`);
            }
        }

        const allFiles = await readdir(tempDir);
        console.log(`\n  Total files on disk:    ${allFiles.length}`);
        console.log(`  Total files tracked:    ${totalFilesTracked}`);

        // Verify every file on disk was tracked exactly once
        const trackedFilenames = new Set(fileAssociations.flatMap(a => a.files.map(f => basename(f))));
        const diskFilenames = new Set(allFiles);
        const untracked = [...diskFilenames].filter(f => !trackedFilenames.has(f));
        if (untracked.length > 0) {
            console.error(`\n  ERROR: ${untracked.length} file(s) on disk were NOT tracked by any association!`);
            for (const f of untracked) console.error(`    - ${f}`);
        } else {
            console.log(`  Tracking verified:      every file on disk belongs to exactly one association`);
        }

        // Verify no association has duplicate files
        const allTrackedFiles = fileAssociations.flatMap(a => [...a.files]);
        const uniqueTracked = new Set(allTrackedFiles);
        if (uniqueTracked.size !== allTrackedFiles.length) {
            console.error(`\n  ERROR: ${allTrackedFiles.length - uniqueTracked.size} duplicate file(s) across associations!`);
        } else {
            console.log(`  No duplicate tracking:  ${uniqueTracked.size} unique files across ${fileAssociations.length} association(s)`);
        }

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
