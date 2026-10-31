import { isMidiFileName } from './midiFiles.ts';

interface PermissionDescriptor {
  mode: 'read' | 'readwrite';
}

interface PermissionHandle {
  queryPermission(descriptor: PermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor: PermissionDescriptor): Promise<PermissionState>;
}

type DirectoryPicker = (options: {
  id?: string;
  mode?: 'read' | 'readwrite';
}) => Promise<FileSystemDirectoryHandle>;

const READ: PermissionDescriptor = { mode: 'read' };

export function supportsFolderAccess(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = (window as unknown as { showDirectoryPicker: DirectoryPicker })
    .showDirectoryPicker;
  try {
    return await picker({ id: 'xf-midi-library', mode: 'read' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
}

export async function hasReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await asPermissionHandle(handle).queryPermission(READ)) === 'granted';
}

export async function requestReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await asPermissionHandle(handle).requestPermission(READ)) === 'granted';
}

export async function listMidiFileNames(handle: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const [name, entry] of handle.entries()) {
    if (entry.kind === 'file' && isMidiFileName(name)) names.push(name);
  }
  return names;
}

export async function readFolderFile(
  handle: FileSystemDirectoryHandle,
  name: string,
): Promise<File> {
  return (await handle.getFileHandle(name)).getFile();
}

function asPermissionHandle(handle: FileSystemDirectoryHandle): PermissionHandle {
  return handle as unknown as PermissionHandle;
}
