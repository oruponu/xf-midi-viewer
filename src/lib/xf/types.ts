export interface XfFlags {
  hasInfoHeader: boolean;
  hasStyle: boolean;
  hasLyricMeta: boolean;
  hasKaraoke: boolean;
}

export interface XfVersion {
  versionString: string;
  flags: XfFlags;
}
