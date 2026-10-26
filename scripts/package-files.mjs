import path from 'node:path';
import { readdir } from 'node:fs/promises';

const rootFiles = new Set(['manifest.json', 'background.js', 'README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'PRIVACY.md', 'CHANGELOG.md', 'SOURCES.md', 'THIRD_PARTY_NOTICES.md', 'LICENSE', 'LICENSE.md', 'COPYING', 'package.json', 'package-lock.json']);
const directories = new Set(['src', 'assets', 'vendor', 'scripts', 'tests', 'docs']);

export async function collectPackageFiles(root) {
  const filenames = [];
  async function collect(directory = '') {
    const entries = await readdir(path.join(root, directory), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = directory ? `${directory}/${entry.name}` : entry.name;
      if (entry.name.startsWith('.')) continue;
      if (entry.isDirectory() && (directory || directories.has(entry.name))) {
        await collect(relative);
      } else if (entry.isFile() && (directory || rootFiles.has(entry.name) || /\.(html|css)$/.test(entry.name))) {
        filenames.push(relative);
      }
    }
  }
  await collect();
  return filenames;
}

export function assertSingleExtensionManifest(filenames) {
  const manifests = filenames.filter(filename => filename.replaceAll('\\', '/').split('/').at(-1).toLowerCase() === 'manifest.json');
  if (manifests.length !== 1 || manifests[0] !== 'manifest.json') {
    throw new Error(`Cannot package for the Chrome Web Store: expected exactly one manifest.json at the archive root; found ${manifests.length ? manifests.join(', ') : 'none'}. Rename third-party metadata files to provenance.json.`);
  }
}
