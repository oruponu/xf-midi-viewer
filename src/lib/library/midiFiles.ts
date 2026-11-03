export const MIDI_EXTENSIONS: readonly string[] = ['.mid', '.midi', '.kar', '.xih', '.xkm'];

export function isMidiFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return MIDI_EXTENSIONS.some((ext) => lower.length > ext.length && lower.endsWith(ext));
}

export function topLevelMidiFiles(files: readonly File[]): File[] {
  return files.filter((file) => {
    const path = file.webkitRelativePath;
    const depth = path ? path.split('/').length - 1 : 1;
    return depth === 1 && isMidiFileName(file.name);
  });
}
