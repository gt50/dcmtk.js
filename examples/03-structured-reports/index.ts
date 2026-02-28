/**
 * Example 03: Structured Reports
 *
 * Demonstrates creating, dumping, and round-tripping DICOM Structured
 * Reports using xml2dsr, dsrdump, and dsr2xml.
 *
 * Run: pnpm tsx examples/03-structured-reports/index.ts
 */
import { join } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { xml2dsr, dsrdump, dsr2xml, unwrap } from '@ubercode/dcmtk';

// Minimal Comprehensive SR XML template (DCMTK dsr2xml/xml2dsr format)
const SR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<report type="Comprehensive SR">
  <sopclass uid="1.2.840.10008.5.1.4.1.1.88.33">Comprehensive SR</sopclass>
  <charset>ISO_IR 100</charset>
  <modality>SR</modality>
  <manufacturer>dcmtk.js Example</manufacturer>
  <patient>
    <name>DOE^JOHN</name>
    <id>EX-001</id>
  </patient>
  <study>
    <uid>1.2.3.4.5</uid>
    <date>20260228</date>
  </study>
  <series>
    <uid>1.2.3.4.5.1</uid>
    <number>1</number>
  </series>
  <instance>
    <uid>1.2.3.4.5.1.1</uid>
    <number>1</number>
  </instance>
  <document>
    <content>
      <text relationship="contains" valtype="TEXT">
        <conceptname>
          <meaning>Finding</meaning>
          <designator>DCM</designator>
          <version>01</version>
          <value>121071</value>
        </conceptname>
        <value>This is a sample structured report created by dcmtk.js.</value>
      </text>
    </content>
  </document>
</report>`;

async function main() {
    console.log('=== Example 03: Structured Reports ===\n');

    const tempDir = await mkdtemp(join(tmpdir(), 'dcmtk-ex03-'));

    try {
        // 1. Write SR XML to temp file
        const xmlPath = join(tempDir, 'report.xml');
        await writeFile(xmlPath, SR_XML, 'utf-8');
        console.log(`SR XML template written to: ${xmlPath}`);

        // -------------------------------------------------------------------
        // 2. xml2dsr — convert XML to DICOM SR file
        // -------------------------------------------------------------------
        console.log('\n--- xml2dsr: XML -> DICOM SR ---');
        const srPath = join(tempDir, 'report.dcm');
        const convertResult = await xml2dsr(xmlPath, srPath);

        if (!convertResult.ok) {
            console.error(`  xml2dsr failed: ${convertResult.error.message}`);
            console.log('  (This may happen if your DCMTK version has strict SR validation.)');
            return;
        }
        console.log(`  DICOM SR created: ${srPath}`);

        // -------------------------------------------------------------------
        // 3. dsrdump — dump SR content as human-readable text
        // -------------------------------------------------------------------
        console.log('\n--- dsrdump output ---');
        const dumpResult = await dsrdump(srPath);

        if (dumpResult.ok) {
            console.log(dumpResult.value.text);
        } else {
            console.log(`  dsrdump failed: ${dumpResult.error.message}`);
        }

        // -------------------------------------------------------------------
        // 4. dsr2xml — convert DICOM SR back to XML (round-trip)
        // -------------------------------------------------------------------
        console.log('\n--- dsr2xml: DICOM SR -> XML (round-trip) ---');
        const backResult = await dsr2xml(srPath);

        if (backResult.ok) {
            const preview = backResult.value.text.slice(0, 800);
            console.log(preview);
            if (backResult.value.text.length > 800) {
                console.log('...');
            }
        } else {
            console.log(`  dsr2xml failed: ${backResult.error.message}`);
        }

        console.log('\nDone.');
    } finally {
        await rm(tempDir, { recursive: true, force: true });
        console.log('Temp files cleaned up.');
    }
}

main().catch(console.error);
