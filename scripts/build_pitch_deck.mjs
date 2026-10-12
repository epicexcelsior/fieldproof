#!/usr/bin/env node
// Legacy HTML-to-PowerPoint exporter. The supplied PowerPoint now owns the deck.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if ((await fs.readFile(path.join(root, 'docs/competition/slides.html'), 'utf8')).includes('class="deck-image"')) {
  throw new Error('The supplied docs/competition/fieldproof-pitch.pptx is canonical. Render it to refresh the PDF and slide images. This legacy exporter cannot rebuild the supplied deck.');
}
const outputDirectory = process.argv[2] && path.resolve(process.argv[2]);
const runtimeModules = process.env.RUNTIME_NODE_MODULES;
const skillDirectory = process.env.PRESENTATIONS_SKILL_DIR;
const pythonExecutable = process.env.RUNTIME_PYTHON;
if (!outputDirectory || !runtimeModules || !skillDirectory || !pythonExecutable) {
  throw new Error('Supply a new output directory, RUNTIME_NODE_MODULES, PRESENTATIONS_SKILL_DIR, and RUNTIME_PYTHON.');
}
await fs.mkdir(outputDirectory, { recursive: false });
const requireRuntime = createRequire(path.join(runtimeModules, '__runtime__.cjs'));
const { Presentation, PresentationFile } = await import(pathToFileURL(requireRuntime.resolve('@oai/artifact-tool')).href);
const { finalizePresentation, resolvePresentationFont } = await import(pathToFileURL(path.join(skillDirectory, 'container_tools/artifact_tool_utils.mjs')).href);
const font = resolvePresentationFont({ fontFamily: 'Liberation Sans' });
const source = await fs.readFile(path.join(root, 'docs/competition/slides.html'), 'utf8');
const sections = [...source.matchAll(/<section class="slide(?: [^"]*)?"[^>]*>([\s\S]*?)<\/section>/g)].map(match => match[1]);
if (sections.length !== 5) throw new Error('The canonical HTML deck must contain exactly five slides.');
const plain = value => value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
const title = section => plain(section.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? '');
const paragraphs = section => [...section.matchAll(/<p(?: class="([^"]*)")?[^>]*>([\s\S]*?)<\/p>/g)].map(match => ({ kind: match[1] ?? '', text: plain(match[2]) }));
const headings = section => [...section.matchAll(/<h2(?: class="([^"]*)")?>([\s\S]*?)<\/h2>/g)].map(match => ({ kind: match[1] ?? '', text: plain(match[2]) }));
const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const palette = { background: '#FFFFFF', text: '#111111', muted: '#555555' };
function text(slide, content, left, top, width, height, size = 28, color = palette.text, bold = false) {
  const box = slide.shapes.add({ geometry: 'textbox', position: { left, top, width, height }, fill: 'none', line: { fill: 'none', width: 0 } });
  box.text = content;
  box.text.style = { typeface: font, fontSize: size, color, bold, autoFit: 'none', verticalAlignment: 'top', lineSpacing: 1.15, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
  return box;
}
for (let index = 0; index < sections.length; index++) {
  const section = sections[index], slide = presentation.slides.add();
  slide.background.fill = palette.background;
  const p = paragraphs(section), h = headings(section);
  if (index === 0) {
    text(slide, p[0].text, 72, 220, 1136, 50, 30);
    text(slide, title(section), 72, 295, 1136, 230, 76, palette.text, true);
  } else {
    text(slide, title(section), 72, 62, index === 4 ? 1020 : 1136, 118, 49, palette.text, true);
    if (index === 1) {
      text(slide, h[0].text, 72, 290, 420, 55, 38, palette.text, true);
      text(slide, p[0].text, 72, 350, 420, 55, 25);
      text(slide, p[1].text, 480, 273, 275, 54, 23);
      text(slide, p[2].text, 560, 327, 95, 75, 52);
      text(slide, h[1].text, 830, 290, 375, 55, 38, palette.text, true);
      text(slide, p[3].text, 830, 350, 375, 55, 25);
      text(slide, p[4].text, 72, 480, 1136, 65, 32);
      text(slide, p[5].text, 72, 608, 1136, 60, 21, palette.muted);
    } else if (index === 2) {
      slide.images.add({ blob: await fs.readFile(path.join(root, 'docs/assets/fieldproof-real-device.webp')), contentType: 'image/webp', alt: 'Actual ESP32 prototype', fit: 'contain', position: { left: 72, top: 195, width: 410, height: 235 } });
      text(slide, p[0].text, 72, 442, 430, 80, 21, palette.muted);
      for (let i = 0; i < 3; i++) {
        text(slide, h[i].text, 548, 193 + i * 99, 650, 38, 27, palette.text, true);
        text(slide, p[i + 1].text, 548, 232 + i * 99, 650, 49, 29);
      }
      for (let i = 0; i < 2; i++) {
        text(slide, h[i + 3].text, i === 0 ? 72 : 682, 565, 526, 42, 28, palette.text, true);
        text(slide, p[i + 4].text, i === 0 ? 72 : 682, 610, 526, 82, 24);
      }
    } else if (index === 3) {
      for (let i = 0; i < 2; i++) {
        text(slide, h[i].text, i === 0 ? 72 : 682, 280, 526, 60, 42, palette.text, true);
        text(slide, p[i].text, i === 0 ? 72 : 682, 351, 510, 105, 29);
      }
      text(slide, p[2].text, 72, 488, 1136, 80, 32);
      text(slide, p[3].text, 72, 608, 1136, 62, 21, palette.muted);
    } else {
      slide.images.add({ blob: await fs.readFile(path.join(root, 'docs/competition/assets/fieldproof-logo.png')), contentType: 'image/png', alt: 'FieldProof logo', fit: 'contain', position: { left: 1115, top: 45, width: 100, height: 100 } });
      text(slide, p[0].text, 72, 220, 1136, 80, 43, palette.text, true);
      text(slide, p[1].text, 72, 331, 1120, 92, 29);
      text(slide, p[2].text, 72, 439, 1136, 65, 29);
      text(slide, p[3].text, 72, 518, 1136, 65, 29);
      text(slide, p[4].text, 72, 618, 1136, 55, 21, palette.muted);
    }
  }
  const notes = [
    'Opening and founder context. Explain why software needs a fresh physical answer across device owners.',
    'Explain a commissioned measurement. Payment buys the check, including an unfavorable answer. A common workflow across independent operators is the product hypothesis.',
    'Working evidence: docs/evidence/current-job.json and docs/VERIFICATION.md. One real ESP32 provider. Seeker independently verifies receipts. Solana Devnet pays 0.001 test USDC. The buyer resolves the peaq Agung device key before payment. The completed job has a finalized native Storage work record. No EventRegistry or credit rating is claimed.',
    'The unchanged receipt timestamp expires under the ten-second buyer policy. An edited local copy fails the original signature. A signature authenticates a claim, not physical truth.',
    'Future network, customer demand, recurring paid use, and reputation remain unvalidated. Start with one authorized operator and one recurring question. Integration and per-check fees are hypotheses. Logo supplied by the founder.'
  ];
  slide.speakerNotes.textFrame.setText(notes[index] + ' Copy source: docs/competition/slides.html.');
}
const candidatePath = path.join(outputDirectory, 'candidate.pptx');
const finalDirectory = path.join(outputDirectory, 'final');
await fs.mkdir(finalDirectory);
const finalPath = path.join(finalDirectory, 'fieldproof-pitch.pptx');
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
// Give the artifact project metadata rather than the exporter's default author.
const metadata = spawnSync(pythonExecutable, ['-c', `
import os, sys, tempfile, zipfile
from xml.etree import ElementTree as ET
source = sys.argv[1]
ns = {'dc': 'http://purl.org/dc/elements/1.1/', 'cp': 'http://schemas.openxmlformats.org/package/2006/metadata/core-properties'}
handle, temporary = tempfile.mkstemp(suffix='.pptx', dir=os.path.dirname(source))
os.close(handle)
try:
    with zipfile.ZipFile(source) as reader, zipfile.ZipFile(temporary, 'w') as writer:
        for item in reader.infolist():
            content = reader.read(item.filename)
            if item.filename == 'docProps/core.xml':
                document = ET.fromstring(content)
                for tag, value in [('dc:creator', 'FieldProof'), ('cp:lastModifiedBy', 'FieldProof'), ('dc:title', 'FieldProof: paid physical checks')]:
                    element = document.find(tag, ns)
                    if element is None:
                        namespace, name = tag.split(':')
                        element = ET.SubElement(document, '{' + ns[namespace] + '}' + name)
                    element.text = value
                content = ET.tostring(document, encoding='utf-8', xml_declaration=True)
            writer.writestr(item, content)
    os.replace(temporary, source)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
`, candidatePath], { encoding: 'utf8' });
if (metadata.status !== 0) throw new Error('Project metadata update failed before presentation validation.');
const result = await finalizePresentation({
  workspaceDir: root,
  candidatePath,
  finalPath,
  explicitTotalSlideCount: 5,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [],
  pythonExecutable,
  integrityValidatorPath: path.join(skillDirectory, 'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(skillDirectory, 'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs: ['--expected-slide-size-emu', '12192000,6858000', '--validate-heading-fit'],
  fontPolicy: { basis: 'design', families: ['Liberation Sans'] },
  verifyArtifactToolImport: true,
  receiptPath: path.join(outputDirectory, 'validation.json'),
});
if (!result) throw new Error('Presentation finalization returned no result.');
console.log(JSON.stringify({ finalPath, slides: 5, htmlSource: 'docs/competition/slides.html' }));
