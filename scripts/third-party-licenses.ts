import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface PackageJson {
  name: string;
  version: string;
  license?: string;
  dependencies?: Record<string, string>;
}

interface Entry {
  name: string;
  version: string;
  license: string;
  text: string;
}

const root = process.cwd();
const outFile = join(root, process.argv[2] ?? 'public/third-party-licenses.txt');
const entries = new Map<string, Entry>();

function readPackage(dir: string): PackageJson {
  return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as PackageJson;
}

function resolvePackageDir(name: string, fromDir: string): string {
  const nested = join(fromDir, 'node_modules', name);
  if (existsSync(join(nested, 'package.json'))) return nested;
  const hoisted = join(root, 'node_modules', name);
  if (existsSync(join(hoisted, 'package.json'))) return hoisted;
  throw new Error(`${name}: package not found`);
}

function visit(name: string, fromDir: string): void {
  if (entries.has(name)) return;
  const dir = resolvePackageDir(name, fromDir);
  const pkg = readPackage(dir);
  const licenseFile = readdirSync(dir).find((file) => /^(licen[cs]e|copying)(\.|$)/i.test(file));
  if (!licenseFile) throw new Error(`${name}: license file not found`);
  entries.set(name, {
    name,
    version: pkg.version,
    license: pkg.license ?? 'UNKNOWN',
    text: readFileSync(join(dir, licenseFile), 'utf8').trim(),
  });
  for (const dependency of Object.keys(pkg.dependencies ?? {})) visit(dependency, dir);
}

for (const dependency of Object.keys(readPackage(root).dependencies ?? {})) visit(dependency, root);

const separator = `\n\n${'-'.repeat(72)}\n\n`;
const body = [...entries.values()]
  .sort((a, b) => a.name.localeCompare(b.name))
  .map((entry) => `${entry.name} ${entry.version} (${entry.license})\n\n${entry.text}`)
  .join(separator);

writeFileSync(
  outFile,
  `XF MIDI Viewer includes the following third-party software.${separator}${body}\n`,
);
console.log(`Wrote ${entries.size} licenses to ${outFile}`);
