import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { Library } from '../hooks/useLibrary.ts';

export function LibraryFolderButton({
  library,
  mode,
  className,
  children,
}: {
  library: Library;
  mode: 'replace' | 'add';
  className?: string;
  children: ReactNode;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  if (library.supportsFolderAccess) {
    return (
      <button type="button" className={className} onClick={library.chooseFolder}>
        {children}
      </button>
    );
  }

  return (
    <>
      <input
        type="file"
        multiple
        hidden
        ref={(input) => {
          inputRef.current = input;
          if (input) input.webkitdirectory = true;
        }}
        onChange={(e) => {
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = '';
          if (files.length > 0) library.importFolder(files, mode);
        }}
      />
      <button type="button" className={className} onClick={() => inputRef.current?.click()}>
        {children}
      </button>
    </>
  );
}
