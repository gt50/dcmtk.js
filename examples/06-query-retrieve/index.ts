/**
 * Example 06: Query/Retrieve Workflow
 *
 * Demonstrates a complete PACS query/retrieve workflow:
 * - DcmQRSCP as the Q/R SCP (query/retrieve server)
 * - StoreSCP as a C-MOVE destination
 * - dcmqridx to index DICOM files into the Q/R database
 * - findscu for C-FIND queries
 * - getscu for C-GET retrieval
 * - movescu for C-MOVE retrieval
 * - PacsClient for high-level PACS operations
 *
 * Run: pnpm tsx examples/06-query-retrieve/index.ts
 */
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { DcmQRSCP, StoreSCP, dcmqridx, dcm2json, findscu, getscu, movescu, DicomDataset, PacsClient } from '@ubercode/dcmtk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SAMPLE = resolve(__dirname, '../../dicomSamples/other/0002d.DCM');

const QR_AE = 'EXAMPLEQR';
const MOVE_AE = 'MOVEDEST';

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

/** Generate a minimal dcmqrscp.cfg configuration file. */
interface QRConfigOptions {
    port: number;
    aeTitle: string;
    storageArea: string;
    moveDestinations?: Array<{ name: string; aeTitle: string; host: string; port: number }>;
}

function generateQRConfig(options: QRConfigOptions): string {
    const hostEntries = (options.moveDestinations ?? []).map(d => `${d.name} = (${d.aeTitle}, ${d.host}, ${d.port})`).join('\n');

    return [
        `NetworkTCPPort  = ${options.port}`,
        'MaxPDUSize      = 16384',
        'MaxAssociations = 16',
        '',
        'HostTable BEGIN',
        hostEntries,
        'HostTable END',
        '',
        'VendorTable BEGIN',
        'VendorTable END',
        '',
        'AETable BEGIN',
        `${options.aeTitle} ${options.storageArea.replace(/\\/g, '/')} RW (200, 1024mb) ANY`,
        'AETable END',
        '',
    ].join('\n');
}

async function main() {
    console.log('=== Example 06: Query/Retrieve Workflow ===\n');

    // -----------------------------------------------------------------------
    // Setup phase — create temp dirs, allocate ports, start servers
    // -----------------------------------------------------------------------
    const tempDir = await mkdtemp(join(tmpdir(), 'dcmtk-ex06-'));
    const dbDir = join(tempDir, 'db', QR_AE);
    const moveDestDir = join(tempDir, 'moveDest');
    const getDestDir = join(tempDir, 'getDest');

    await mkdir(dbDir, { recursive: true });
    await mkdir(moveDestDir, { recursive: true });
    await mkdir(getDestDir, { recursive: true });

    const qrPort = await getAvailablePort();
    const movePort = await getAvailablePort();

    let qrServer: DcmQRSCP | undefined;
    let moveScp: StoreSCP | undefined;

    try {
        console.log('--- Setting up mini PACS environment ---');

        // 1. Copy sample DICOM into the storage area
        await copyFile(SAMPLE, join(dbDir, 'sample.dcm'));
        console.log('  Sample DICOM file copied to storage area.');

        // 2. Index with dcmqridx
        const idxResult = await dcmqridx({ indexDirectory: dbDir, inputFiles: [join(dbDir, 'sample.dcm')] });
        if (!idxResult.ok) {
            console.error(idxResult.error.message);
            return;
        }
        console.log('  DICOM file indexed in Q/R database.');

        // 3. Read StudyInstanceUID for queries
        const jsonResult = await dcm2json(join(dbDir, 'sample.dcm'));
        if (!jsonResult.ok) {
            console.error(jsonResult.error.message);
            return;
        }
        const dsResult = DicomDataset.fromJson(jsonResult.value.data);
        if (!dsResult.ok) {
            console.error(dsResult.error.message);
            return;
        }
        const ds = dsResult.value;
        const studyUID = ds.studyInstanceUID;
        if (!studyUID) throw new Error('Sample file has no StudyInstanceUID');
        console.log(`  Study Instance UID: ${studyUID}`);

        // 4. Generate Q/R config
        const configContent = generateQRConfig({
            port: qrPort,
            aeTitle: QR_AE,
            storageArea: dbDir,
            moveDestinations: [{ name: 'movedest', aeTitle: MOVE_AE, host: 'localhost', port: movePort }],
        });
        const configFile = join(tempDir, 'dcmqrscp.cfg');
        await writeFile(configFile, configContent, 'utf-8');

        // 5. Start StoreSCP as C-MOVE destination
        const moveScpResult = StoreSCP.create({ port: movePort, outputDirectory: moveDestDir, aeTitle: MOVE_AE });
        if (!moveScpResult.ok) {
            console.error(moveScpResult.error.message);
            return;
        }
        moveScp = moveScpResult.value;
        const moveStartResult = await moveScp.start();
        if (!moveStartResult.ok) {
            console.error(moveStartResult.error.message);
            return;
        }
        await sleep(1000);
        console.log(`  StoreSCP (move destination) started on port ${movePort}.`);

        // 6. Start DcmQRSCP
        const qrCreateResult = DcmQRSCP.create({ configFile, port: qrPort, startTimeoutMs: 15_000 });
        if (!qrCreateResult.ok) {
            console.error(qrCreateResult.error.message);
            return;
        }
        qrServer = qrCreateResult.value;
        const qrStartResult = await qrServer.start();
        if (!qrStartResult.ok) {
            console.error(qrStartResult.error.message);
            return;
        }
        await sleep(1000);
        console.log(`  DcmQRSCP started on port ${qrPort}.\n`);

        // -------------------------------------------------------------------
        // findscu — STUDY-level C-FIND query
        // -------------------------------------------------------------------
        console.log('--- findscu: STUDY-level query ---');
        const findResult = await findscu({
            host: '127.0.0.1',
            port: qrPort,
            calledAETitle: QR_AE,
            queryModel: 'study',
            keys: ['0008,0052=STUDY', `0020,000D=${studyUID}`],
            timeoutMs: 30_000,
        });
        if (findResult.ok) {
            console.log(`  findscu succeeded: ${findResult.value.success}`);
        } else {
            console.log(`  findscu failed: ${findResult.error.message}`);
        }

        // -------------------------------------------------------------------
        // getscu — C-GET retrieve to local directory
        // -------------------------------------------------------------------
        console.log('\n--- getscu: C-GET retrieve ---');
        const getResult = await getscu({
            host: '127.0.0.1',
            port: qrPort,
            calledAETitle: QR_AE,
            queryModel: 'study',
            keys: ['0008,0052=STUDY', `0020,000D=${studyUID}`],
            outputDirectory: getDestDir,
            timeoutMs: 30_000,
        });
        if (getResult.ok) {
            console.log(`  getscu succeeded: ${getResult.value.success}`);
            await sleep(2000);
            const getFiles = await readdir(getDestDir);
            console.log(`  Retrieved ${getFiles.length} file(s) to output directory`);
        } else {
            console.log(`  getscu failed: ${getResult.error.message}`);
        }

        // -------------------------------------------------------------------
        // movescu — C-MOVE to StoreSCP destination
        // -------------------------------------------------------------------
        console.log('\n--- movescu: C-MOVE retrieve ---');
        const moveResult = await movescu({
            host: '127.0.0.1',
            port: qrPort,
            calledAETitle: QR_AE,
            queryModel: 'study',
            keys: ['0008,0052=STUDY', `0020,000D=${studyUID}`],
            moveDestination: MOVE_AE,
            timeoutMs: 30_000,
        });
        if (moveResult.ok) {
            console.log(`  movescu succeeded: ${moveResult.value.success}`);
            await sleep(2000);
            const moveFiles = await readdir(moveDestDir);
            console.log(`  Move destination received ${moveFiles.length} file(s)`);
        } else {
            console.log(`  movescu failed: ${moveResult.error.message}`);
        }

        // -------------------------------------------------------------------
        // PacsClient — high-level PACS API
        // -------------------------------------------------------------------
        console.log('\n--- PacsClient: high-level PACS API ---');
        const clientResult = PacsClient.create({
            host: '127.0.0.1',
            port: qrPort,
            calledAETitle: QR_AE,
        });
        if (!clientResult.ok) {
            console.error(clientResult.error.message);
            return;
        }
        const client = clientResult.value;

        // C-ECHO
        const echoResult = await client.echo({ timeoutMs: 10_000 });
        console.log(`  echo(): ${echoResult.ok ? 'connected' : echoResult.error.message}`);

        // Find all studies
        const studies = await client.findStudies({}, { timeoutMs: 30_000 });
        if (studies.ok) {
            console.log(`  findStudies(): found ${studies.value.length} study(ies)`);
            for (const study of studies.value) {
                console.log(`    - Patient: ${study.patientName ?? '(unknown)'}`);
                console.log(`      Study UID: ${study.studyInstanceUID ?? '(unknown)'}`);
                console.log(`      Modality:  ${study.modality ?? '(unknown)'}`);
                console.log(`      Date:      ${study.studyDate ?? '(unknown)'}`);
            }
        } else {
            console.log(`  findStudies() failed: ${studies.error.message}`);
        }

        console.log('\nDone.');
    } finally {
        // Cleanup — stop servers and remove temp files
        try {
            await qrServer?.stop();
        } catch {
            /* already stopped */
        }
        try {
            await moveScp?.stop();
        } catch {
            /* already stopped */
        }
        await rm(tempDir, { recursive: true, force: true });
        console.log('Servers stopped and temp files cleaned up.');
    }
}

main().catch(console.error);
