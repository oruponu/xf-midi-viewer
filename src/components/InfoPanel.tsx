import type { ReactNode } from 'react';
import type {
  XfData,
  XfInfoHeaderCommon,
  XfInfoHeaderLanguageSpecific,
  XfVersion,
} from '../lib/xf/types.ts';

export function InfoPanel({ data }: { data: XfData }) {
  const empty =
    data.version === null &&
    data.commonHeader === null &&
    data.languageHeaders.length === 0;

  if (empty) {
    return (
      <section className="info-panel">
        <div className="card">
          <p className="muted">XFデータは含まれていません</p>
        </div>
      </section>
    );
  }

  return (
    <section className="info-panel">
      {data.version && <VersionSection version={data.version} />}
      {data.commonHeader && <CommonSection header={data.commonHeader} />}
      {data.languageHeaders.map((h, i) => (
        <LanguageSection key={`${h.language}-${i}`} header={h} />
      ))}
    </section>
  );
}

function VersionSection({ version }: { version: XfVersion }) {
  const flags: ReadonlyArray<readonly [string, boolean]> = [
    ['XF Information Header', version.flags.hasInfoHeader],
    ['XF Style Message', version.flags.hasStyle],
    ['Lyric Meta-Event', version.flags.hasLyricMeta],
    ['XF Karaoke Message', version.flags.hasKaraoke],
  ];
  return (
    <div className="card">
      <h3>XF Version</h3>
      <div className="version-row">
        <span className="badge">{version.versionString}</span>
        <ul className="flag-list">
          {flags.map(([name, on]) => (
            <li key={name} className={on ? 'flag-on' : 'flag-off'}>
              {name}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const COMMON_FIELDS: ReadonlyArray<
  readonly [Exclude<keyof XfInfoHeaderCommon, 'kind'>, string]
> = [
  ['date', '発表日'],
  ['country', '制作地'],
  ['category', 'ジャンル'],
  ['beat', 'ビート'],
  ['instrumentOnMelody', 'メロディ楽器（GM#）'],
  ['vocalType', '歌唱タイプ'],
  ['composer', '作曲者'],
  ['lyricist', '作詞者'],
  ['arranger', '編曲者'],
  ['performer', '演奏者'],
  ['programmer', '制作者'],
  ['keyword', 'キーワード'],
];

function CommonSection({ header }: { header: XfInfoHeaderCommon }) {
  return (
    <div className="card">
      <h3>共通ヘッダー (XFhd)</h3>
      <FieldList>
        {COMMON_FIELDS.map(([key, label]) => {
          const value = header[key];
          return value === undefined ? null : (
            <Field key={key} label={label} value={value} />
          );
        })}
      </FieldList>
    </div>
  );
}

const LANG_FIELDS: ReadonlyArray<
  readonly [
    Exclude<keyof XfInfoHeaderLanguageSpecific, 'kind' | 'language'>,
    string,
  ]
> = [
  ['songName', '曲名'],
  ['composer', '作曲者'],
  ['lyricist', '作詞者'],
  ['arranger', '編曲者'],
  ['performer', '演奏者'],
  ['programmer', '制作者'],
];

function LanguageSection({ header }: { header: XfInfoHeaderLanguageSpecific }) {
  return (
    <div className="card">
      <h3>
        言語別ヘッダー (XFln){' '}
        <span className="badge-small">{header.language}</span>
      </h3>
      <FieldList>
        {LANG_FIELDS.map(([key, label]) => {
          const value = header[key];
          return value === undefined ? null : (
            <Field key={key} label={label} value={value} />
          );
        })}
      </FieldList>
    </div>
  );
}

function FieldList({ children }: { children: ReactNode }) {
  return <dl className="info-dl">{children}</dl>;
}

function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="info-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
