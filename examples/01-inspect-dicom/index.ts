/**
 * Example 01: Inspect DICOM Files
 *
 * Demonstrates reading DICOM metadata using dcmdump, dcm2xml, dcm2json,
 * and the high-level DicomDataset API with convenience getters.
 *
 * Run: pnpm tsx examples/01-inspect-dicom/index.ts
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dcmdump, dcm2xml, dcm2json, unwrap, DicomDataset } from '@ubercode/dcmtk';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SAMPLE = resolve(__dirname, '../../dicomSamples/1010_brain_mr_12_jpg/IM-0001-0001.dcm');

async function main() {
    console.log('=== Example 01: Inspect DICOM Files ===\n');

    // -----------------------------------------------------------------------
    // 1. dcmdump — dump DICOM headers as human-readable text
    // -----------------------------------------------------------------------
    console.log('--- dcmdump output (first 20 lines) ---');
    const dumpResult = unwrap(await dcmdump(SAMPLE));
    const lines = dumpResult.text.split('\n').slice(0, 20);
    console.log(lines.join('\n'));

    // -----------------------------------------------------------------------
    // 2. dcm2xml — convert to XML representation
    // -----------------------------------------------------------------------
    console.log('\n--- dcm2xml output (first 500 chars) ---');
    const xmlResult = unwrap(await dcm2xml(SAMPLE));
    console.log(xmlResult.xml.slice(0, 500));
    console.log('...\n');

    // -----------------------------------------------------------------------
    // 3. dcm2json + DicomDataset — structured access via JSON model
    // -----------------------------------------------------------------------
    console.log('--- DicomDataset convenience getters ---');
    const jsonResult = unwrap(await dcm2json(SAMPLE));
    const ds = unwrap(DicomDataset.fromJson(jsonResult.data));

    console.log(`  Patient Name:       ${ds.patientName ?? '(not set)'}`);
    console.log(`  Patient ID:         ${ds.patientID ?? '(not set)'}`);
    console.log(`  Study Date:         ${ds.studyDate ?? '(not set)'}`);
    console.log(`  Modality:           ${ds.modality ?? '(not set)'}`);
    console.log(`  Study Instance UID: ${ds.studyInstanceUID ?? '(not set)'}`);

    // -----------------------------------------------------------------------
    // 4. getString() and hasTag() — lower-level access
    // -----------------------------------------------------------------------
    console.log('\n--- getString() and hasTag() ---');
    console.log(`  Patient Age (00101010):     ${ds.getString('00101010') ?? '(not present)'}`);
    console.log(`  Has PatientName (00100010):  ${ds.hasTag('00100010')}`);
    console.log(`  Has Allergies (00102110):    ${ds.hasTag('00102110')}`);

    console.log('\nDone.');
}

main().catch(console.error);
