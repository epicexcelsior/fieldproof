#!/usr/bin/env node
// The scriptless HTML deck owns slide copy. This exports editable PowerPoint text.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
const sections = [...source.matchAll(/<section class="slide"[^>]*>([\s\S]*?)<\/section>/g)].map(match => match[1]);
if (sections.length !== 5) throw new Error('The canonical HTML deck must contain exactly five slides.');
const plain = value => value.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
const title = section => plain(section.match(/<h1>([\s\S]*?)<\/h1>/)?.[1] ?? '');
const paragraphs = section => [...section.matchAll(/<p(?: class="([^"]*)")?>([\s\S]*?)<\/p>/g)].map(match => ({ kind: match[1] ?? '', text: plain(match[2]) }));
const headings = section => [...section.matchAll(/<h2(?: class="([^"]*)")?>([\s\S]*?)<\/h2>/g)].map(match => ({ kind: match[1] ?? '', text: plain(match[2]) }));
const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });
const palette = { background: '#F4FAFF', text: '#17364D', blue: '#126C97', muted: '#536D80', pending: '#9A5617' };
function text(slide, content, left, top, width, height, size = 28, color = palette.text, bold = false) {
  const box = slide.shapes.add({ geometry: 'textbox', position: { left, top, width, height }, fill: 'none', line: { fill: 'none', width: 0 } });
  box.text = content;
  box.text.style = { typeface: font, fontSize: size, color, bold, autoFit: 'none', verticalAlignment: 'top', lineSpacing: 1.18, insets: { top: 0, right: 0, bottom: 0, left: 0 } };
  return box;
}
for (let index = 0; index < sections.length; index++) {
  const section = sections[index];
  const slide = presentation.slides.add();
  slide.background.fill = palette.background;
  text(slide, title(section), 72, 48, 1136, 90, 46, palette.text, true);
  const p = paragraphs(section);
  const h = headings(section);
  if (index === 0) {
    text(slide, p[0].text, 72, 184, 820, 138, 42, palette.blue, true);
    text(slide, p[1].text, 72, 350, 850, 148, 30);
    text(slide, p[2].text, 72, 552, 900, 44, 23, palette.muted);
    slide.images.add({ blob: await fs.readFile(path.join(root, 'docs/competition/assets/fieldproof-project.png')), contentType: 'image/png', alt: 'FieldProof logo', fit: 'contain', position: { left: 960, top: 210, width: 250, height: 250 } });
  } else if (index === 2) {
    for (let step = 0; step < 4; step++) {
      const left = step % 2 === 0 ? 72 : 682;
      const top = step < 2 ? 188 : 400;
      text(slide, h[step].text, left, top, 526, 54, 30, palette.blue, true);
      text(slide, p[step].text, left, top + 65, 520, 132, 27);
    }
  } else {
    for (let column = 0; column < 2; column++) {
      const left = column === 0 ? 72 : 682;
      text(slide, h[column].text, left, 190, 526, 70, 29, h[column].kind === 'pending' ? palette.pending : palette.blue, true);
      text(slide, p[column * 2].text, left, 278, 514, 122, 28);
      const paragraph = p[column * 2 + 1];
      text(slide, paragraph.text, left, 420, 514, 136, paragraph.kind === 'minor' ? 23 : 28, paragraph.kind === 'minor' ? palette.muted : palette.text);
    }
    const next = p.find(paragraph => paragraph.kind === 'next');
    if (next) text(slide, next.text, 72, 578, 1136, 62, 25, palette.blue);
  }
  text(slide, plain(section.match(/<footer>([\s\S]*?)<\/footer>/)?.[1] ?? ''), 72, 659, 1136, 44, 18, palette.muted);
  slide.speakerNotes.textFrame.setText(`Content source: docs/competition/slides.html. Implementation and evidence: docs/VERIFICATION.md and docs/evidence/device-signed-purchase-20261011.json. Buyer value and commercial pricing are hypotheses. The Solana transaction uses test tokens. Real Agung identity and native Storage work readbacks passed on October 12. No EventRegistry event or credit rating is claimed. Slide ${index + 1} of 5.`);
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
