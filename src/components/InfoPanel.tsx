import type { ReactNode } from 'react';
import type {
  KaraokeEvent,
  VocalPart,
  XfData,
  XfInfoHeaderCommon,
  XfInfoHeaderLanguageSpecific,
  XfKaraokeData,
  XfLyricsHeader,
  XfVersion,
} from '../lib/xf/types.ts';

export function InfoPanel({ data }: { data: XfData }) {
  const hasKaraoke =
    data.karaoke.header !== null || data.karaoke.events.length > 0;
  const empty =
    data.version === null &&
    data.commonHeader === null &&
    data.languageHeaders.length === 0 &&
    !hasKaraoke;

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
      {hasKaraoke && <KaraokeSection data={data.karaoke} />}
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

const VOCAL_PART_LABELS: Record<VocalPart, string> = {
  male: '男性',
  female: '女性',
  chorus: 'コーラス',
  solo: '独唱',
  mixed: '混声',
  speech: 'セリフ',
  nonLyric: '歌詞以外',
};

function KaraokeSection({ data }: { data: XfKaraokeData }) {
  return (
    <div className="card">
      <h3>XF Karaoke Message</h3>
      {data.header && <KaraokeHeaderInfo header={data.header} />}
      {data.events.length > 0 && (
        <div className="karaoke-stream">
          {data.events.map((ev, i) => renderKaraokeEvent(ev, i))}
        </div>
      )}
    </div>
  );
}

function KaraokeHeaderInfo({ header }: { header: XfLyricsHeader }) {
  return (
    <FieldList>
      <Field label="言語" value={header.language ?? '（未指定 / Latin-1）'} />
      <Field
        label="メロディCH"
        value={
          header.melodyChannels.length > 0
            ? header.melodyChannels.join(', ')
            : '（なし）'
        }
      />
      <Field label="表示オフセット" value={`${header.displayOffset} ticks`} />
    </FieldList>
  );
}

function renderKaraokeEvent(ev: KaraokeEvent, index: number): ReactNode {
  switch (ev.kind) {
    case 'lyric':
      return (
        <span key={index} className="lyric">
          {ev.text}
        </span>
      );
    case 'carriageReturn':
    case 'lineFeed':
      return <br key={index} />;
    case 'vocalPart':
      return (
        <span key={index} className="part-badge">
          {VOCAL_PART_LABELS[ev.part]}
        </span>
      );
  }
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
