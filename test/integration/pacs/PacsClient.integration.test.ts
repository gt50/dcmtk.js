import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Result } from '../../../src/types';
import { DcmQRSCP } from '../../../src/servers/DcmQRSCP';
import { StoreSCP } from '../../../src/servers/StoreSCP';
import { dcmqridx } from '../../../src/tools/dcmqridx';
import { dcm2json } from '../../../src/tools/dcm2json';
import { DicomDataset } from '../../../src/dicom/DicomDataset';
import { PacsClient } from '../../../src/pacs/PacsClient';
import { RetrieveMode } from '../../../src/pacs/types';
import { dcmtkAvailable, SAMPLES, getAvailablePort, createTempDir, removeTempDir, copyDicomToTemp, generateQRConfig } from '../helpers';

/** Unwrap a Result or throw a setup error with context. */
function unwrapSetup<T>(result: Result<T>, context: string): T {
    if (!result.ok) throw new Error(`${context}: ${result.error.message}`);
    return result.value;
}

/** Index a sample DICOM file and read its Study/Series UIDs. */
async function indexAndReadUIDs(sampleDir: string): Promise<{ studyUID: string; seriesUID: string }> {
    unwrapSetup(await dcmqridx({ indexDirectory: sampleDir, inputFiles: [join(sampleDir, 'sample.dcm')] }), 'dcmqridx setup failed');
    const jsonResult = unwrapSetup(await dcm2json(join(sampleDir, 'sample.dcm')), 'dcm2json setup failed');
    const ds = unwrapSetup(DicomDataset.fromJson(jsonResult.data), 'DicomDataset setup failed');
    const studyUID = ds.studyInstanceUID;
    const seriesUID = ds.seriesInstanceUID;
    if (studyUID === undefined) throw new Error('Sample file has no StudyInstanceUID');
    if (seriesUID === undefined) throw new Error('Sample file has no SeriesInstanceUID');
    return { studyUID, seriesUID };
}

/** Create and start a StoreSCP, returning the started instance. */
async function startStoreSCP(port: number, outputDirectory: string, aeTitle: string): Promise<StoreSCP> {
    const scp = unwrapSetup(StoreSCP.create({ port, outputDirectory, aeTitle }), `StoreSCP (${aeTitle}) create failed`);
    unwrapSetup(await scp.start(), `StoreSCP (${aeTitle}) start failed`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    return scp;
}

describe.skipIf(!dcmtkAvailable)('PacsClient integration', () => {
    let tempDir: string;
    let dbDir: string;
    let outputDir: string;
    let moveDestDir: string;
    let storeReceiveDir: string;
    let qrPort: number;
    let movePort: number;
    let storePort: number;
    let studyInstanceUID: string;
    let seriesInstanceUID: string;

    let qrServer: DcmQRSCP;
    let moveScp: StoreSCP;
    let storeScp: StoreSCP;
    let client: PacsClient;

    const QR_AE = 'TESTQR';
    const MOVE_AE = 'MOVESCP';
    const STORE_AE = 'STORESCP';

    beforeAll(async () => {
        // 1. Create temp dirs
        tempDir = await createTempDir('pacs-integ-');
        dbDir = join(tempDir, 'db', QR_AE);
        outputDir = join(tempDir, 'output');
        moveDestDir = join(tempDir, 'moveDest');
        storeReceiveDir = join(tempDir, 'storeReceive');
        await mkdir(dbDir, { recursive: true });
        await mkdir(outputDir, { recursive: true });
        await mkdir(moveDestDir, { recursive: true });
        await mkdir(storeReceiveDir, { recursive: true });

        // 2. Copy sample DICOM, index it, and read UIDs
        await copyDicomToTemp(SAMPLES.OTHER_0002D, dbDir, 'sample.dcm');
        const uids = await indexAndReadUIDs(dbDir);
        studyInstanceUID = uids.studyUID;
        seriesInstanceUID = uids.seriesUID;

        // 3. Get 3 available ports
        qrPort = await getAvailablePort();
        movePort = await getAvailablePort();
        storePort = await getAvailablePort();

        // 4. Generate dcmqrscp.cfg and start DcmQRSCP
        const configContent = generateQRConfig({
            port: qrPort,
            aeTitle: QR_AE,
            storageArea: dbDir,
            moveDestinations: [{ name: 'movescp', aeTitle: MOVE_AE, host: 'localhost', port: movePort }],
        });
        await writeFile(join(tempDir, 'dcmqrscp.cfg'), configContent, 'utf-8');

        qrServer = unwrapSetup(DcmQRSCP.create({ configFile: join(tempDir, 'dcmqrscp.cfg'), port: qrPort, startTimeoutMs: 15_000 }), 'DcmQRSCP.create');
        unwrapSetup(await qrServer.start(), 'DcmQRSCP start');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 5. Start StoreSCPs and create PacsClient
        moveScp = await startStoreSCP(movePort, moveDestDir, MOVE_AE);
        storeScp = await startStoreSCP(storePort, storeReceiveDir, STORE_AE);
        client = unwrapSetup(PacsClient.create({ host: '127.0.0.1', port: qrPort, calledAETitle: QR_AE }), 'PacsClient.create');
    }, 60_000);

    afterAll(async () => {
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
        try {
            await storeScp?.stop();
        } catch {
            /* already stopped */
        }
        if (tempDir !== undefined) {
            await removeTempDir(tempDir);
        }
    });

    // -----------------------------------------------------------------------
    // create() validation
    // -----------------------------------------------------------------------

    describe('create()', () => {
        it('creates a client with valid config', () => {
            const result = PacsClient.create({
                host: '127.0.0.1',
                port: qrPort,
                calledAETitle: QR_AE,
            });
            expect(result.ok).toBe(true);
        });

        it('rejects empty host', () => {
            const result = PacsClient.create({ host: '', port: 104 });
            expect(result.ok).toBe(false);
        });

        it('rejects port 0', () => {
            const result = PacsClient.create({ host: 'localhost', port: 0 });
            expect(result.ok).toBe(false);
        });

        it('rejects port above 65535', () => {
            const result = PacsClient.create({ host: 'localhost', port: 65536 });
            expect(result.ok).toBe(false);
        });

        it('rejects AE title longer than 16 characters', () => {
            const result = PacsClient.create({
                host: 'localhost',
                port: 104,
                callingAETitle: 'A'.repeat(17),
            });
            expect(result.ok).toBe(false);
        });

        it('accepts minimal config (host + port only)', () => {
            const result = PacsClient.create({ host: 'localhost', port: 11112 });
            expect(result.ok).toBe(true);
        });

        it('rejects unknown properties', () => {
            const result = PacsClient.create({ host: 'localhost', port: 104, unknown: true } as never);
            expect(result.ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // echo()
    // -----------------------------------------------------------------------

    describe('echo()', () => {
        it('succeeds against DcmQRSCP', async () => {
            const result = await client.echo();
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.success).toBe(true);
                expect(result.value.rttMs).toBeGreaterThanOrEqual(0);
            }
        });

        it('fails against an unused port', async () => {
            const unusedPort = await getAvailablePort();
            const badClient = PacsClient.create({
                host: '127.0.0.1',
                port: unusedPort,
            });
            if (!badClient.ok) throw badClient.error;

            const result = await badClient.value.echo({ timeoutMs: 5_000 });
            expect(result.ok).toBe(false);
        });

        it('respects AbortSignal', async () => {
            const controller = new AbortController();
            controller.abort();
            const result = await client.echo({ signal: controller.signal });
            expect(result.ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // findStudies()
    // -----------------------------------------------------------------------

    describe('findStudies()', () => {
        it('returns datasets for known study UID', async () => {
            const result = await client.findStudies({ studyInstanceUID: studyInstanceUID }, { timeoutMs: 30_000 });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.length).toBeGreaterThan(0);
            }
        });

        it('returns empty for nonexistent patient', async () => {
            const result = await client.findStudies({ patientId: 'NONEXISTENT_PAT_999' }, { timeoutMs: 30_000 });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.length).toBe(0);
            }
        });

        it('datasets have expected return keys', async () => {
            const result = await client.findStudies({ studyInstanceUID: studyInstanceUID }, { timeoutMs: 30_000 });
            expect(result.ok).toBe(true);
            if (result.ok && result.value.length > 0) {
                const dataset = result.value[0];
                // Study-level return keys should include StudyInstanceUID
                expect(dataset?.studyInstanceUID).toBe(studyInstanceUID);
            }
        });
    });

    // -----------------------------------------------------------------------
    // findSeries()
    // -----------------------------------------------------------------------

    describe('findSeries()', () => {
        it('returns series for known study', async () => {
            const result = await client.findSeries({ studyInstanceUID: studyInstanceUID }, { timeoutMs: 30_000 });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.length).toBeGreaterThan(0);
            }
        });

        it('returns empty for nonexistent UID', async () => {
            const result = await client.findSeries({ studyInstanceUID: '9.9.9.9.9.9.9.9' }, { timeoutMs: 30_000 });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.length).toBe(0);
            }
        });
    });

    // -----------------------------------------------------------------------
    // findImages()
    // -----------------------------------------------------------------------

    describe('findImages()', () => {
        it('returns images for known study + series', async () => {
            const result = await client.findImages({ studyInstanceUID: studyInstanceUID, seriesInstanceUID: seriesInstanceUID }, { timeoutMs: 30_000 });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.length).toBeGreaterThan(0);
            }
        });

        it('returns empty for nonexistent series', async () => {
            const result = await client.findImages({ studyInstanceUID: studyInstanceUID, seriesInstanceUID: '9.9.9.9.9.9' }, { timeoutMs: 30_000 });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.length).toBe(0);
            }
        });
    });

    // -----------------------------------------------------------------------
    // find() (raw query)
    // -----------------------------------------------------------------------

    describe('find()', () => {
        it('raw study-level query works', async () => {
            const result = await client.find(['0008,0052=STUDY', `0020,000d=${studyInstanceUID}`], { timeoutMs: 30_000 });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.length).toBeGreaterThan(0);
            }
        });

        it('empty keys returns error', async () => {
            const result = await client.find([]);
            expect(result.ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // retrieveStudy() — C-GET
    // -----------------------------------------------------------------------

    describe('retrieveStudy() C-GET', () => {
        it('retrieves files to output dir', async () => {
            const getDir = join(tempDir, 'get-study');
            await mkdir(getDir, { recursive: true });

            const result = await client.retrieveStudy(studyInstanceUID, {
                outputDirectory: getDir,
                timeoutMs: 30_000,
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.success).toBe(true);
                expect(result.value.outputDirectory).toBe(getDir);
            }

            // Wait for files to settle
            await new Promise(resolve => setTimeout(resolve, 3000));
            const files = await readdir(getDir);
            expect(files.length).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // retrieveStudy() — C-MOVE
    // -----------------------------------------------------------------------

    describe('retrieveStudy() C-MOVE', () => {
        it('retrieves via move destination', async () => {
            const result = await client.retrieveStudy(studyInstanceUID, {
                outputDirectory: moveDestDir,
                mode: RetrieveMode.C_MOVE,
                moveDestination: MOVE_AE,
                timeoutMs: 30_000,
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.success).toBe(true);
            }

            // Wait for files to arrive at move destination
            await new Promise(resolve => setTimeout(resolve, 3000));
            const files = await readdir(moveDestDir);
            expect(files.length).toBeGreaterThan(0);
        });

        it('returns error when moveDestination is missing', async () => {
            const result = await client.retrieveStudy(studyInstanceUID, {
                outputDirectory: outputDir,
                mode: RetrieveMode.C_MOVE,
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
                expect(result.error.message).toContain('moveDestination');
            }
        });
    });

    // -----------------------------------------------------------------------
    // retrieveSeries() — C-GET
    // -----------------------------------------------------------------------

    describe('retrieveSeries() C-GET', () => {
        it('retrieves series files', async () => {
            const seriesDir = join(tempDir, 'get-series');
            await mkdir(seriesDir, { recursive: true });

            const result = await client.retrieveSeries(studyInstanceUID, seriesInstanceUID, {
                outputDirectory: seriesDir,
                timeoutMs: 30_000,
            });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.success).toBe(true);
            }

            await new Promise(resolve => setTimeout(resolve, 3000));
            const files = await readdir(seriesDir);
            expect(files.length).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // store()
    // -----------------------------------------------------------------------

    describe('store()', () => {
        it('sends file to StoreSCP and verifies receipt', async () => {
            const storeClient = PacsClient.create({
                host: '127.0.0.1',
                port: storePort,
                calledAETitle: STORE_AE,
            });
            if (!storeClient.ok) throw storeClient.error;

            const result = await storeClient.value.store([join(dbDir, 'sample.dcm')], { timeoutMs: 30_000 });
            expect(result.ok).toBe(true);
            if (result.ok) {
                expect(result.value.success).toBe(true);
                expect(result.value.fileCount).toBe(1);
            }

            // Wait for file to arrive
            await new Promise(resolve => setTimeout(resolve, 3000));
            const files = await readdir(storeReceiveDir);
            expect(files.length).toBeGreaterThan(0);
        });

        it('fails when connection refused', async () => {
            const unusedPort = await getAvailablePort();
            const badClient = PacsClient.create({
                host: '127.0.0.1',
                port: unusedPort,
            });
            if (!badClient.ok) throw badClient.error;

            const result = await badClient.value.store([join(dbDir, 'sample.dcm')], { timeoutMs: 5_000 });
            expect(result.ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Error cases + timeout
    // -----------------------------------------------------------------------

    describe('error cases', () => {
        it('echo fails against non-existent host', async () => {
            const badClient = PacsClient.create({
                host: '192.0.2.1', // TEST-NET-1 — guaranteed unreachable
                port: 104,
            });
            if (!badClient.ok) throw badClient.error;

            const result = await badClient.value.echo({ timeoutMs: 5_000 });
            expect(result.ok).toBe(false);
        });

        it('findStudies fails on connection refused', async () => {
            const unusedPort = await getAvailablePort();
            const badClient = PacsClient.create({
                host: '127.0.0.1',
                port: unusedPort,
            });
            if (!badClient.ok) throw badClient.error;

            const result = await badClient.value.findStudies({ patientId: 'PAT001' }, { timeoutMs: 5_000 });
            expect(result.ok).toBe(false);
        });

        it('retrieveStudy fails on connection refused', async () => {
            const unusedPort = await getAvailablePort();
            const badClient = PacsClient.create({
                host: '127.0.0.1',
                port: unusedPort,
            });
            if (!badClient.ok) throw badClient.error;

            const getDir = join(tempDir, 'get-refused');
            await mkdir(getDir, { recursive: true });

            const result = await badClient.value.retrieveStudy('1.2.3', {
                outputDirectory: getDir,
                timeoutMs: 5_000,
            });
            expect(result.ok).toBe(false);
        });
    });

    // -----------------------------------------------------------------------
    // Timeout behavior
    // -----------------------------------------------------------------------

    describe('timeout', () => {
        it('method timeout override works', async () => {
            const unusedPort = await getAvailablePort();
            const badClient = PacsClient.create({
                host: '127.0.0.1',
                port: unusedPort,
                timeoutMs: 60_000, // large client-level timeout
            });
            if (!badClient.ok) throw badClient.error;

            const start = Date.now();
            const result = await badClient.value.echo({ timeoutMs: 3_000 }); // short method timeout
            const elapsed = Date.now() - start;

            expect(result.ok).toBe(false);
            // Method timeout of 3s should take effect, not the 60s client timeout
            expect(elapsed).toBeLessThan(30_000);
        });
    });

    // -----------------------------------------------------------------------
    // Note: findWorklist() skipped — requires Wlmscpfs + .wl data files
    // not available in the standard test setup. TODO: add when worklist
    // infrastructure is available.
    // -----------------------------------------------------------------------
});
