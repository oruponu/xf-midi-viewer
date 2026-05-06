import type { ReactNode } from 'react';
import { formatTickAsBarBeat } from '../lib/smf/timing.ts';
import type { SmfTiming } from '../lib/smf/timing.ts';
import { formatChord } from '../lib/xf/format.ts';
import { parseKaraoke } from '../lib/xf/lyrics.ts';
import type { LyricRun, LyricToken, ParsedKaraoke } from '../lib/xf/lyrics.ts';
import type {
  GuitarPart,
  StyleMessage,
  VocalPart,
  XfData,
  XfInfoHeaderCommon,
  XfInfoHeaderLanguageSpecific,
  XfLyricsHeader,
  XfStyleData,
  XfVersion,
} from '../lib/xf/types.ts';
import { LeadSheet } from './LeadSheet.tsx';

export function InfoPanel({ data }: { data: XfData }) {
  const hasKaraoke =
    data.karaoke.header !== null || data.karaoke.events.length > 0;
  const hasStyle = data.style.events.length > 0;
  const empty =
    data.version === null &&
    data.commonHeader === null &&
    data.languageHeaders.length === 0 &&
    !hasKaraoke &&
    !hasStyle;

  if (empty) {
    return (
      <section className="info-panel">
        <div className="card">
          <p className="muted">XFデータは含まれていません</p>
        </div>
      </section>
    );
  }

  const parsedKaraoke = parseKaraoke(data.karaoke);

  const chordsForChart: ChordMsg[] = [];
  const rehearsalsForChart: RehearsalMsg[] = [];
  for (const ev of data.style.events) {
    if (ev.kind === 'chord') chordsForChart.push(ev);
    else if (ev.kind === 'rehearsal') rehearsalsForChart.push(ev);
  }
  const showChart =
    chordsForChart.length > 0 ||
    rehearsalsForChart.length > 0 ||
    parsedKaraoke.syllables.length > 0;

  return (
    <section className="info-panel">
      {data.version && <VersionSection version={data.version} />}
      {showChart && (
        <LeadSheet
          chords={chordsForChart}
          rehearsals={rehearsalsForChart}
          syllables={parsedKaraoke.syllables}
          timing={data.timing}
        />
      )}
      {data.commonHeader && <CommonSection header={data.commonHeader} />}
      {data.languageHeaders.map((h, i) => (
        <LanguageSection key={`${h.language}-${i}`} header={h} />
      ))}
      {hasKaraoke && (
        <KaraokeSection
          parsed={parsedKaraoke}
          rehearsals={rehearsalsForChart}
        />
      )}
      {hasStyle && <StyleSection data={data.style} timing={data.timing} />}
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

function KaraokeSection({
  parsed,
  rehearsals,
}: {
  parsed: ParsedKaraoke;
  rehearsals: RehearsalMsg[];
}) {
  const { replaceWithDivider, dividerBefore } = computeKaraokeSectionBreaks(
    parsed.tokens,
    rehearsals,
  );

  return (
    <div className="card">
      <h3>XF Karaoke Message</h3>
      {parsed.header && <KaraokeHeaderInfo header={parsed.header} />}
      {parsed.tokens.length > 0 && (
        <div className="karaoke-stream">
          {renderKaraokeStream(
            parsed.tokens,
            replaceWithDivider,
            dividerBefore,
          )}
        </div>
      )}
    </div>
  );
}

function renderKaraokeStream(
  tokens: LyricToken[],
  replaceWithDivider: Set<number>,
  dividerBefore: Set<number>,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last: 'br' | 'hr' | 'inline' = 'br';

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;

    if (dividerBefore.has(i)) {
      if (last === 'br') out.pop();
      out.push(<hr key={`d-${i}`} className="karaoke-section-break" />);
      last = 'hr';
    }

    if (replaceWithDivider.has(i)) {
      if (last === 'br') out.pop();
      out.push(<hr key={i} className="karaoke-section-break" />);
      last = 'hr';
      continue;
    }

    if (tok.kind === 'lineBreak' || tok.kind === 'pageBreak') {
      if (last === 'br' || last === 'hr') continue;
      out.push(<br key={i} />);
      last = 'br';
      continue;
    }

    out.push(renderToken(tok, i));
    if (tok.kind === 'syllable' || tok.kind === 'vocalPart') {
      last = 'inline';
    }
  }

  return out;
}

function computeKaraokeSectionBreaks(
  tokens: LyricToken[],
  rehearsals: RehearsalMsg[],
): { replaceWithDivider: Set<number>; dividerBefore: Set<number> } {
  const replaceWithDivider = new Set<number>();
  const dividerBefore = new Set<number>();
  if (rehearsals.length === 0) {
    return { replaceWithDivider, dividerBefore };
  }

  let consumedBreakIdx = -1;

  for (let rIdx = 0; rIdx < rehearsals.length; rIdx += 1) {
    const r = rehearsals[rIdx]!;
    const nextRehearsalTick = rehearsals[rIdx + 1]?.tick ?? Infinity;

    let backIdx = -1;
    let fwdIdx = -1;
    for (let i = consumedBreakIdx + 1; i < tokens.length; i += 1) {
      const tok = tokens[i]!;
      if (tok.tick >= nextRehearsalTick) break;
      if (tok.kind !== 'lineBreak' && tok.kind !== 'pageBreak') continue;
      if (tok.tick <= r.tick) {
        backIdx = i;
      } else {
        fwdIdx = i;
        break;
      }
    }

    let chosenIdx = -1;
    if (backIdx !== -1 && fwdIdx !== -1) {
      let backChunk = 0;
      let fwdChunk = 0;
      for (let i = backIdx + 1; i < fwdIdx; i += 1) {
        const tok = tokens[i]!;
        if (tok.kind !== 'syllable') continue;
        if (tok.tick <= r.tick) backChunk += 1;
        else fwdChunk += 1;
      }
      chosenIdx = backChunk <= fwdChunk ? backIdx : fwdIdx;
    } else if (backIdx !== -1) {
      chosenIdx = backIdx;
    } else if (fwdIdx !== -1) {
      chosenIdx = fwdIdx;
    }

    if (chosenIdx !== -1) {
      replaceWithDivider.add(chosenIdx);
      consumedBreakIdx = chosenIdx;
    } else {
      const fallbackIdx = tokens.findIndex((t) => t.tick >= r.tick);
      if (fallbackIdx > 0) dividerBefore.add(fallbackIdx);
    }
  }

  return { replaceWithDivider, dividerBefore };
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

function renderToken(tok: LyricToken, index: number): ReactNode {
  switch (tok.kind) {
    case 'syllable':
      return (
        <span key={index} className="lyric">
          {tok.runs.map((run, j) => renderRun(run, j))}
        </span>
      );
    case 'lineBreak':
    case 'pageBreak':
      return <br key={index} />;
    case 'subBreak':
      return <wbr key={index} />;
    case 'vocalPart':
      return (
        <span key={index} className="part-badge">
          {VOCAL_PART_LABELS[tok.part]}
        </span>
      );
  }
}

function renderRun(run: LyricRun, index: number): ReactNode {
  if (run.kind === 'text') {
    return <span key={index}>{run.text}</span>;
  }
  return (
    <ruby key={index}>
      {run.base}
      <rt>{run.reading}</rt>
    </ruby>
  );
}

const GUITAR_PART_LABELS: Record<GuitarPart, string> = {
  guitar: 'ギター',
  bass: 'ベース',
  ukulele: 'ウクレレ',
  reserved: '不明',
};

type ChordMsg = Extract<StyleMessage, { kind: 'chord' }>;
type RehearsalMsg = Extract<StyleMessage, { kind: 'rehearsal' }>;
type GuideTrackMsg = Extract<StyleMessage, { kind: 'guideTrack' }>;
type GuitarInfoMsg = Extract<StyleMessage, { kind: 'guitarInfo' }>;
type MaxPhraseMsg = Extract<StyleMessage, { kind: 'maxPhraseMark' }>;

interface StyleGroups {
  chords: ChordMsg[];
  rehearsals: RehearsalMsg[];
  phraseCount: number;
  maxPhrases: MaxPhraseMsg[];
  fingeringCount: number;
  guideTracks: GuideTrackMsg[];
  guitarInfos: GuitarInfoMsg[];
  guitarVoicingCount: number;
}

function partitionStyle(events: StyleMessage[]): StyleGroups {
  const chords: ChordMsg[] = [];
  const rehearsals: RehearsalMsg[] = [];
  const maxPhrases: MaxPhraseMsg[] = [];
  const guideTracks: GuideTrackMsg[] = [];
  const guitarInfos: GuitarInfoMsg[] = [];
  let phraseCount = 0;
  let fingeringCount = 0;
  let guitarVoicingCount = 0;

  for (const ev of events) {
    switch (ev.kind) {
      case 'chord':
        chords.push(ev);
        break;
      case 'rehearsal':
        rehearsals.push(ev);
        break;
      case 'phraseMark':
        phraseCount += 1;
        break;
      case 'maxPhraseMark':
        maxPhrases.push(ev);
        break;
      case 'fingering':
        fingeringCount += 1;
        break;
      case 'guideTrack':
        guideTracks.push(ev);
        break;
      case 'guitarInfo':
        guitarInfos.push(ev);
        break;
      case 'guitarVoicing':
        guitarVoicingCount += 1;
        break;
    }
  }

  return {
    chords,
    rehearsals,
    phraseCount,
    maxPhrases,
    fingeringCount,
    guideTracks,
    guitarInfos,
    guitarVoicingCount,
  };
}

function StyleSection({
  data,
  timing,
}: {
  data: XfStyleData;
  timing: SmfTiming;
}) {
  const g = partitionStyle(data.events);
  const formatTick = (tick: number): string =>
    formatTickAsBarBeat(tick, timing);
  const showSummary =
    g.phraseCount > 0 ||
    g.fingeringCount > 0 ||
    g.guitarVoicingCount > 0 ||
    g.maxPhrases.length > 0;

  return (
    <div className="card">
      <h3>XF Style Message</h3>

      {g.guideTracks.length > 0 && (
        <StyleSubSection title="ガイドトラックフラグ">
          {g.guideTracks.map((gt, i) => (
            <div key={i} className="style-row">
              右手: {gt.rightHandChannel ?? '（なし）'} / 左手:{' '}
              {gt.leftHandChannel ?? '（なし）'}
            </div>
          ))}
        </StyleSubSection>
      )}

      {g.guitarInfos.length > 0 && (
        <StyleSubSection title="ギターインフォメーションフラグ">
          {g.guitarInfos.map((gi, i) => (
            <div key={i} className="style-row">
              {GUITAR_PART_LABELS[gi.part]} (CH {gi.channel ?? '全'}), カポ{' '}
              {gi.capo}, チューニング: {gi.stringNotes.join(', ')}
            </div>
          ))}
        </StyleSubSection>
      )}

      {g.chords.length > 0 && (
        <StyleSubSection title={`コード名 (${g.chords.length})`}>
          <div className="style-list">
            {g.chords.map((c, i) => (
              <div key={i} className="style-list-row">
                <span className="tick">{formatTick(c.tick)}</span>
                <span>{formatChord(c.root, c.type, c.bass)}</span>
              </div>
            ))}
          </div>
        </StyleSubSection>
      )}

      {g.rehearsals.length > 0 && (
        <StyleSubSection title={`リハーサルマーク (${g.rehearsals.length})`}>
          <div className="style-list">
            {g.rehearsals.map((r, i) => (
              <div key={i} className="style-list-row">
                <span className="tick">{formatTick(r.tick)}</span>
                <span>
                  {r.letter}
                  {r.variation > 0 && "'".repeat(r.variation)}
                </span>
              </div>
            ))}
          </div>
        </StyleSubSection>
      )}

      {showSummary && (
        <StyleSubSection title="その他">
          <div className="style-summary">
            {g.phraseCount > 0 && <span>フレーズマーク: {g.phraseCount}</span>}
            {g.maxPhrases[0] && (
              <span>最大レベル8フレーズ数: {g.maxPhrases[0].count}</span>
            )}
            {g.fingeringCount > 0 && <span>運指番号: {g.fingeringCount}</span>}
            {g.guitarVoicingCount > 0 && (
              <span>ギター押弦: {g.guitarVoicingCount}</span>
            )}
          </div>
        </StyleSubSection>
      )}
    </div>
  );
}

function StyleSubSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="style-subsection">
      <h4>{title}</h4>
      {children}
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
