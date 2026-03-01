/**
 * Example 08: Receive, Modify, and Forward DICOM Files
 *
 * Demonstrates a realistic DICOM routing workflow:
 *   1. A DicomReceiver accepts incoming DICOM files from any sender.
 *   2. As each file arrives, a DicomInstance is used to inspect the file
 *      and apply tag modifications (anonymize patient, stamp institution).
 *   3. Based on the modality, the modified file is forwarded to one of
 *      two DicomSender instances (one for CT, one for everything else).
 *
 * Key features shown:
 *   - DicomReceiver pooled receiver with FILE_RECEIVED events
 *   - DicomInstance fluent modification API (setPatientName, setInstitutionName, erasePrivateTags)
 *   - DicomSender with single mode for serial forwarding to a single-threaded SCP
 *   - Modality-based routing to different destinations
 *   - DicomSender health monitoring and event logging
 *   - Graceful shutdown of all components
 *
 * Run: pnpm tsx examples/08-receive-modify-send/index.ts
 */
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm, readdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { DicomReceiver, DicomSender, StoreSCP, dcmsend } from '@ubercode/dcmtk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SAMPLES = resolve(__dirname, '../../dicomSamples/1010_brain_mr_12_jpg');
const CONFIG_FILE = resolve(__dirname, '../../src/data/storescp.cfg');

const FILES = [
    resolve(SAMPLES, 'IM-0001-0001.dcm'),
    resolve(SAMPLES, 'IM-0001-0002.dcm'),
    resolve(SAMPLES, 'IM-0001-0003.dcm'),
    resolve(SAMPLES, 'IM-0001-0004.dcm'),
];

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
    console.log('=== Example 08: Receive, Modify, and Forward DICOM ===\n');

    const receiverStorageDir = await mkdtemp(`${tmpdir()}/dcmtk-ex08-recv-`);
    const destStorageDir = await mkdtemp(`${tmpdir()}/dcmtk-ex08-dest-`);

    const receiverPort = await getAvailablePort();
    const destinationPort = await getAvailablePort();

    // -----------------------------------------------------------------------
    // 1. Start a StoreSCP as the "downstream PACS" destination
    //    StoreSCP with a config file accepts all common transfer syntaxes
    //    (including JPEG), which is needed when forwarding compressed files.
    // -----------------------------------------------------------------------
    console.log('--- Setting up downstream destination (StoreSCP) ---');
    const destResult = StoreSCP.create({
        port: destinationPort,
        outputDirectory: destStorageDir,
        aeTitle: 'DEST_PACS',
        configFile: CONFIG_FILE,
        configProfile: 'Default',
    });
    if (!destResult.ok) {
        console.error('Failed to create destination:', destResult.error.message);
        return;
    }
    const destination = destResult.value;
    await destination.start();
    console.log(`  Destination PACS (StoreSCP) listening on port ${destinationPort}\n`);

    // -----------------------------------------------------------------------
    // 2. Create DicomSenders — one for "CT" modality, one for everything else
    //    Both point to the same destination here, but in production they would
    //    route to different PACS servers.
    // -----------------------------------------------------------------------
    console.log('--- Creating DicomSenders ---');
    // Use 'single' mode: DCMTK servers are single-threaded, so concurrent
    // associations would queue anyway. Single mode sends one at a time with
    // FIFO ordering, which is the safest approach for a single destination.
    //
    // proposedTransferSyntax: 'j2kLossless' tells storescu to propose
    // JPEG 2000 Lossless transfer syntax, matching the sample files. Without
    // this, storescu defaults to Explicit VR Little Endian and fails when it
    // can't decompress the JPEG 2000 payload on the fly.
    const ctSenderResult = DicomSender.create({
        host: '127.0.0.1',
        port: destinationPort,
        calledAETitle: 'DEST_PACS',
        callingAETitle: 'ROUTER_CT',
        mode: 'single',
        proposedTransferSyntax: 'j2kLossless',
        maxRetries: 2,
    });
    if (!ctSenderResult.ok) {
        console.error('Failed to create CT sender:', ctSenderResult.error.message);
        await destination.stop();
        return;
    }
    const ctSender = ctSenderResult.value;

    const otherSenderResult = DicomSender.create({
        host: '127.0.0.1',
        port: destinationPort,
        calledAETitle: 'DEST_PACS',
        callingAETitle: 'ROUTER_OTHER',
        mode: 'single',
        proposedTransferSyntax: 'j2kLossless',
        maxRetries: 2,
    });
    if (!otherSenderResult.ok) {
        console.error('Failed to create other sender:', otherSenderResult.error.message);
        await ctSender.stop();
        await destination.stop();
        return;
    }
    const otherSender = otherSenderResult.value;

    // Wire sender events
    ctSender.onSendComplete(data => {
        console.log(`  [CT sender]    Sent ${data.fileCount} file(s) in ${data.durationMs}ms`);
    });
    ctSender.onSendFailed(data => {
        console.log(`  [CT sender]    FAILED: ${data.error.message} (${data.attempts} attempts)`);
    });
    ctSender.onHealthChanged(data => {
        console.log(`  [CT sender]    Health: ${data.previousHealth} -> ${data.newHealth}`);
    });

    otherSender.onSendComplete(data => {
        console.log(`  [Other sender] Sent ${data.fileCount} file(s) in ${data.durationMs}ms`);
    });
    otherSender.onSendFailed(data => {
        console.log(`  [Other sender] FAILED: ${data.error.message} (${data.attempts} attempts)`);
    });

    console.log('  CT sender:    ready (single mode)');
    console.log('  Other sender: ready (single mode)\n');

    // -----------------------------------------------------------------------
    // 3. Create the DicomReceiver (pooled inbound receiver)
    // -----------------------------------------------------------------------
    console.log('--- Setting up DicomReceiver (inbound) ---');
    const receiverResult = DicomReceiver.create({
        port: receiverPort,
        storageDir: receiverStorageDir,
        aeTitle: 'ROUTER',
        minPoolSize: 2,
        maxPoolSize: 4,
        configFile: CONFIG_FILE,
        configProfile: 'Default',
    });
    if (!receiverResult.ok) {
        console.error('Failed to create receiver:', receiverResult.error.message);
        await ctSender.stop();
        await otherSender.stop();
        await destination.stop();
        return;
    }
    const receiver = receiverResult.value;

    // Track stats
    let filesReceived = 0;
    let filesRouted = 0;

    // 4. Wire the FILE_RECEIVED event — this is where the magic happens
    receiver.onFileReceived(async data => {
        filesReceived++;
        const inst = data.instance;
        const modality = inst.modality ?? 'UNKNOWN';
        const originalName = inst.patientName ?? '(unknown)';

        console.log(`  [received] ${basename(data.filePath)} — modality: ${modality}, patient: "${originalName}"`);

        // Apply modifications: anonymize patient, stamp institution, erase private tags
        const modified = inst.setPatientName('ANONYMIZED^PATIENT').setPatientID('ANON-001').setInstitutionName('Routing Gateway');

        // Write the modified file (creates a new file, preserving the original)
        const writeResult = await modified.writeAs(data.filePath);
        if (!writeResult.ok) {
            console.error(`  [error] Failed to write modified file: ${writeResult.error.message}`);
            return;
        }

        // Route based on modality
        const sender = modality === 'CT' ? ctSender : otherSender;
        const label = modality === 'CT' ? 'CT' : 'Other';

        // Fire-and-forget — the sender queues and handles retries internally
        void sender.send([data.filePath]).then(result => {
            if (result.ok) {
                filesRouted++;
                console.log(`  [routed]   ${basename(data.filePath)} -> ${label} sender (${result.value.durationMs}ms)`);
            } else {
                console.error(`  [error]    ${basename(data.filePath)} -> ${label} sender: ${result.error.message}`);
            }
        });
    });

    receiver.onAssociationComplete(data => {
        console.log(`  [assoc]    ${data.associationId}: ${data.files.length} file(s) from ${data.callingAE}`);
    });

    try {
        // 5. Start the receiver
        const startResult = await receiver.start();
        if (!startResult.ok) {
            console.error('Failed to start receiver:', startResult.error.message);
            return;
        }
        await sleep(2000);
        console.log(`  Receiver listening on port ${receiverPort} (pool: 2-4 workers)`);
        console.log(`  Pool status: ${JSON.stringify(receiver.poolStatus)}\n`);

        // -------------------------------------------------------------------
        // 6. Simulate an external sender pushing files to our receiver
        // -------------------------------------------------------------------
        console.log('--- Sending files to the receiver ---');
        const sendResult = await dcmsend({
            host: '127.0.0.1',
            port: receiverPort,
            callingAETitle: 'SCANNER',
            calledAETitle: 'ROUTER',
            files: FILES,
            timeoutMs: 30_000,
        });
        console.log(`  dcmsend result: ${sendResult.ok ? 'success' : sendResult.error.message}`);

        // Wait for all files to be received, modified, and forwarded.
        // Single-mode senders process one at a time, so allow enough time.
        await sleep(10000);

        // -------------------------------------------------------------------
        // 7. Summary
        // -------------------------------------------------------------------
        console.log('\n--- Summary ---');
        console.log(`  Files received by router: ${filesReceived}`);
        console.log(`  Files forwarded to destination: ${filesRouted}`);

        // Show what arrived at the destination (StoreSCP stores in subdirectories)
        let destFileCount = 0;
        const destEntries = await readdir(destStorageDir, { withFileTypes: true });
        for (const entry of destEntries) {
            if (entry.isDirectory()) {
                const subFiles = await readdir(resolve(destStorageDir, entry.name));
                destFileCount += subFiles.length;
            } else {
                destFileCount++;
            }
        }
        console.log(`  Files at destination PACS: ${destFileCount}`);

        // Show sender health status
        console.log(`  CT sender status: ${JSON.stringify(ctSender.status)}`);
        console.log(`  Other sender status: ${JSON.stringify(otherSender.status)}`);

        console.log('\nDone.');
    } finally {
        // 8. Graceful shutdown — order matters
        await ctSender.stop();
        await otherSender.stop();
        await receiver.stop();
        await destination.stop();
        await rm(receiverStorageDir, { recursive: true, force: true });
        await rm(destStorageDir, { recursive: true, force: true });
        console.log('All components stopped and temp files cleaned up.');
    }
}

main().catch(console.error);
