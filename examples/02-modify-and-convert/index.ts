/**
 * Example 02: Modify and Convert DICOM Files
 *
 * Demonstrates modifying DICOM tags with dcmodify, converting transfer
 * syntax with dcmconv, and using the high-level ChangeSet + DicomFile APIs.
 *
 * Run: pnpm tsx examples/02-modify-and-convert/index.ts
 */
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dcmodify, dcmconv, dcm2json, unwrap, DicomDataset, ChangeSet, DicomFile, createDicomTagPath } from '@ubercode/dcmtk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SAMPLE = resolve(__dirname, '../../dicomSamples/1010_brain_mr_12_jpg/IM-0001-0001.dcm');

async function main() {
    console.log('=== Example 02: Modify and Convert DICOM ===\n');

    const tempDir = await mkdtemp(join(tmpdir(), 'dcmtk-ex02-'));

    try {
        // 1. Copy sample to temp dir (never modify originals)
        const workFile = join(tempDir, 'work.dcm');
        await copyFile(SAMPLE, workFile);
        console.log(`Working copy: ${workFile}`);

        // -------------------------------------------------------------------
        // 2. dcmodify — modify PatientName and PatientID
        // -------------------------------------------------------------------
        console.log('\n--- dcmodify: changing PatientName and PatientID ---');
        unwrap(
            await dcmodify(workFile, {
                modifications: [
                    { tag: '(0010,0010)', value: 'EXAMPLE^PATIENT' },
                    { tag: '(0010,0020)', value: 'EX-12345' },
                ],
                noBackup: true,
            })
        );
        console.log('  Tags modified successfully.');

        // 3. Verify changes with dcm2json + DicomDataset
        console.log('\n--- Verifying modifications ---');
        const jsonResult = unwrap(await dcm2json(workFile));
        const ds = unwrap(DicomDataset.fromJson(jsonResult.data));
        console.log(`  Patient Name: ${ds.patientName}`);
        console.log(`  Patient ID:   ${ds.patientID}`);

        // -------------------------------------------------------------------
        // 4. dcmconv — convert transfer syntax to Explicit VR Little Endian
        // -------------------------------------------------------------------
        console.log('\n--- dcmconv: converting to Explicit VR Little Endian ---');
        const convertedFile = join(tempDir, 'converted.dcm');
        unwrap(await dcmconv(workFile, convertedFile, { transferSyntax: '+te' }));
        console.log(`  Converted file: ${convertedFile}`);

        // Verify the converted file
        const convertedJson = unwrap(await dcm2json(convertedFile));
        const convertedDs = unwrap(DicomDataset.fromJson(convertedJson.data));
        console.log(`  Transfer Syntax UID: ${convertedDs.transferSyntaxUID ?? '(not set)'}`);

        // -------------------------------------------------------------------
        // 5. DicomFile + ChangeSet — high-level modification API
        // -------------------------------------------------------------------
        console.log('\n--- DicomFile + ChangeSet API ---');
        const file = unwrap(await DicomFile.open(convertedFile));
        console.log(`  Opened: ${file.filePath}`);
        console.log(`  Current Patient Name: ${file.dataset.patientName}`);

        const nameTag = unwrap(createDicomTagPath('(0010,0010)'));
        const idTag = unwrap(createDicomTagPath('(0010,0020)'));
        const changes = ChangeSet.empty().setTag(nameTag, 'CHANGESET^DEMO').setTag(idTag, 'CS-99999');

        const updated = file.withChanges(changes);
        await updated.applyChanges();
        console.log('  Changes applied via ChangeSet.');

        // Re-read to verify
        const verifyFile = unwrap(await DicomFile.open(convertedFile));
        console.log(`  Patient Name after ChangeSet: ${verifyFile.dataset.patientName}`);
        console.log(`  Patient ID after ChangeSet:   ${verifyFile.dataset.patientID}`);

        console.log('\nDone.');
    } finally {
        await rm(tempDir, { recursive: true, force: true });
        console.log('Temp files cleaned up.');
    }
}

main().catch(console.error);
