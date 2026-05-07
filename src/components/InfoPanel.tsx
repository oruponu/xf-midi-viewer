import { useEffect, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import { formatTickAsBarBeat } from '../lib/smf/timing.ts';
import type { SmfTiming } from '../lib/smf/timing.ts';
import { formatChord } from '../lib/xf/format.ts';
import { parseKaraoke } from '../lib/xf/lyrics.ts';
import type {
  LyricRun,
  LyricSyllable,
  LyricToken,
  ParsedKaraoke,
} from '../lib/xf/lyrics.ts';
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

export type InfoPanelTab = 'leadSheet' | 'lyrics' | 'details';

type FileSummary = {
  name: string;
  size: number;
  lastModified: number;
};

export function InfoPanel({
  file,
  data,
  activeTab,
  activeTick = null,
  sequence = null,
  getPositionSeconds = null,
}: {
  file: FileSummary | null;
  data: XfData;
  activeTab: InfoPanelTab;
  activeTick?: number | null;
  sequence?: PlaybackSequence | null;
  getPositionSeconds?: (() => number) | null;
}) {
  const hasKaraoke =
    data.karaoke.header !== null || data.karaoke.events.length > 0;
  const hasStyle = data.style.events.length > 0;
  const parsedKaraoke = useMemo(
    () => parseKaraoke(data.karaoke),
    [data.karaoke],
  );
  const { chordsForChart, rehearsalsForChart } = useMemo(() => {
    const chordsForChart: ChordMsg[] = [];
    const rehearsalsForChart: RehearsalMsg[] = [];
    for (const ev of data.style.events) {
      if (ev.kind === 'chord') chordsForChart.push(ev);
      else if (ev.kind === 'rehearsal') rehearsalsForChart.push(ev);
    }
    return { chordsForChart, rehearsalsForChart };
  }, [data.style.events]);
  const empty =
    data.version === null &&
    data.commonHeader === null &&
    data.languageHeaders.length === 0 &&
    !hasKaraoke &&
    !hasStyle;

  if (empty) {
    return (
      <section className="info-panel">
        {activeTab === 'details' ? (
          <div className="details-view">
            {file && <FileSection file={file} />}
            <div className="card">
              <p className="muted">XFデータは含まれていません</p>
            </div>
          </div>
        ) : (
          <EmptyView title="表示できるXFデータはありません" />
        )}
      </section>
    );
  }

  const showChart =
    chordsForChart.length > 0 ||
    rehearsalsForChart.length > 0 ||
    parsedKaraoke.syllables.length > 0;

  return (
    <section className="info-panel">
      {activeTab === 'leadSheet' &&
        (showChart ? (
          <LeadSheet
            chords={chordsForChart}
            rehearsals={rehearsalsForChart}
            syllables={parsedKaraoke.syllables}
            timing={data.timing}
            sequence={sequence}
            getPositionSeconds={getPositionSeconds}
          />
        ) : (
          <EmptyView title="リードシート情報はありません" />
        ))}

      {activeTab === 'lyrics' &&
        (hasKaraoke && parsedKaraoke.tokens.length > 0 ? (
          <KaraokeSection
            parsed={parsedKaraoke}
            rehearsals={rehearsalsForChart}
            activeTick={activeTick}
          />
        ) : (
          <EmptyView title="歌詞情報はありません" />
        ))}

      {activeTab === 'details' && (
        <DetailsView
          file={file}
          data={data}
          parsedKaraoke={parsedKaraoke}
          hasStyle={hasStyle}
        />
      )}
    </section>
  );
}

function DetailsView({
  file,
  data,
  parsedKaraoke,
  hasStyle,
}: {
  file: FileSummary | null;
  data: XfData;
  parsedKaraoke: ParsedKaraoke;
  hasStyle: boolean;
}) {
  return (
    <div className="details-view">
      {file && <FileSection file={file} />}
      {data.version && <VersionSection version={data.version} />}
      {data.commonHeader && <CommonSection header={data.commonHeader} />}
      {data.languageHeaders.map((h, i) => (
        <LanguageSection key={`${h.language}-${i}`} header={h} />
      ))}
      {(data.karaoke.header || data.karaoke.events.length > 0) && (
        <KaraokeMetaSection parsed={parsedKaraoke} />
      )}
      {hasStyle && <StyleSection data={data.style} timing={data.timing} />}
    </div>
  );
}

function EmptyView({ title }: { title: string }) {
  return (
    <div className="card empty-view">
      <h3>{title}</h3>
      <p className="muted">詳細タブで解析結果を確認できます</p>
    </div>
  );
}

function FileSection({ file }: { file: FileSummary }) {
  return (
    <div className="card">
      <h3>ファイル情報</h3>
      <FieldList>
        <Field label="File name" value={file.name} />
        <Field label="Size" value={`${file.size.toLocaleString()} bytes`} />
        <Field
          label="Last modified"
          value={new Date(file.lastModified).toLocaleString()}
        />
      </FieldList>
    </div>
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
  activeTick,
}: {
  parsed: ParsedKaraoke;
  rehearsals: RehearsalMsg[];
  activeTick: number | null;
}) {
  const { replaceWithDivider, dividerBefore } = computeKaraokeSectionBreaks(
    parsed.tokens,
    rehearsals,
  );
  const activeSyllableIndex = findActiveSyllableIndex(
    parsed.syllables,
    activeTick,
  );
  const blocks = buildKaraokeBlocks(
    parsed.tokens,
    replaceWithDivider,
    dividerBefore,
    activeSyllableIndex,
  );
  const streamRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (activeSyllableIndex < 0) return;
    const el = streamRef.current?.querySelector('.lyric--active');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeSyllableIndex]);

  return (
    <div className="card">
      <h3>XF Karaoke Message</h3>
      {parsed.header && <KaraokeHeaderInfo header={parsed.header} />}
      {blocks.length > 0 && (
        <div className="karaoke-stream" ref={streamRef}>
          {blocks.flatMap((block, idx) => {
            if (block.kind === 'divider') {
              return [
                <hr key={`div-${idx}`} className="karaoke-section-break" />,
              ];
            }
            return [
              <div key={`bc-${idx}`} className="karaoke-badge-cell">
                {block.part !== null && (
                  <span className="part-badge">
                    {VOCAL_PART_LABELS[block.part]}
                  </span>
                )}
              </div>,
              <div key={`lc-${idx}`} className="karaoke-lyric-cell">
                {block.tokens}
              </div>,
            ];
          })}
        </div>
      )}
    </div>
  );
}

type KaraokeBlock =
  | { kind: 'divider' }
  | { kind: 'lyrics'; part: VocalPart | null; tokens: ReactNode[] };

function buildKaraokeBlocks(
  tokens: LyricToken[],
  replaceWithDivider: Set<number>,
  dividerBefore: Set<number>,
  activeSyllableIndex: number,
): KaraokeBlock[] {
  const blocks: KaraokeBlock[] = [];
  let pendingPart: VocalPart | null = null;
  let activePart: VocalPart | null = null;
  let displayedPart: VocalPart | null = null;
  let currentContent: ReactNode[] = [];
  let lastEmitted: 'br' | 'inline' | null = null;
  let syllableCounter = 0;

  const flushLyrics = (): void => {
    if (lastEmitted === 'br') {
      currentContent.pop();
    }
    if (currentContent.length > 0) {
      const partForBlock =
        activePart !== null && activePart !== displayedPart ? activePart : null;
      blocks.push({
        kind: 'lyrics',
        part: partForBlock,
        tokens: currentContent,
      });
      if (partForBlock !== null) {
        displayedPart = partForBlock;
      }
    }
    currentContent = [];
    lastEmitted = null;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]!;

    if (dividerBefore.has(i)) {
      flushLyrics();
      blocks.push({ kind: 'divider' });
    }

    if (replaceWithDivider.has(i)) {
      flushLyrics();
      blocks.push({ kind: 'divider' });
      continue;
    }

    if (tok.kind === 'vocalPart') {
      pendingPart = tok.part;
      continue;
    }

    if (tok.kind === 'lineBreak' || tok.kind === 'pageBreak') {
      if (lastEmitted === null || lastEmitted === 'br') continue;
      currentContent.push(<br key={i} />);
      lastEmitted = 'br';
      continue;
    }

    if (tok.kind === 'syllable' && pendingPart !== activePart) {
      flushLyrics();
      activePart = pendingPart;
    }

    const isSyllable = tok.kind === 'syllable';
    const isActiveSyllable =
      isSyllable && syllableCounter === activeSyllableIndex;
    const isPassedSyllable =
      isSyllable && syllableCounter <= activeSyllableIndex;
    currentContent.push(
      renderToken(tok, i, isPassedSyllable, isActiveSyllable),
    );
    if (isSyllable) {
      lastEmitted = 'inline';
      syllableCounter += 1;
    }
  }

  flushLyrics();
  return blocks;
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

    if (fwdIdx !== -1 && nextRehearsalTick !== Infinity) {
      const fwdTick = tokens[fwdIdx]!.tick;
      if (fwdTick - r.tick > nextRehearsalTick - fwdTick) {
        fwdIdx = -1;
      }
    }

    let chosenIdx = -1;
    if (backIdx !== -1 && fwdIdx !== -1) {
      let backChunk = 0;
      let fwdChunk = 0;
      for (let i = backIdx + 1; i < fwdIdx; i += 1) {
        const tok = tokens[i]!;
        if (tok.kind !== 'syllable') continue;
        if (tok.tick < r.tick) backChunk += 1;
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

function KaraokeMetaSection({ parsed }: { parsed: ParsedKaraoke }) {
  return (
    <div className="card">
      <h3>XF Karaoke Message</h3>
      {parsed.header && <KaraokeHeaderInfo header={parsed.header} />}
      <div className="style-subsection">
        <h4>解析結果</h4>
        <div className="style-summary">
          <span>トークン: {parsed.tokens.length.toLocaleString()}</span>
          <span>音節: {parsed.syllables.length.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}

function renderToken(
  tok: Exclude<LyricToken, { kind: 'vocalPart' }>,
  index: number,
  isPassed: boolean,
  isActive: boolean,
): ReactNode {
  switch (tok.kind) {
    case 'syllable': {
      let className = 'lyric';
      if (isPassed) className += ' lyric--passed';
      if (isActive) className += ' lyric--active';
      return (
        <span key={index} className={className}>
          {tok.runs.map((run, j) => renderRun(run, j))}
        </span>
      );
    }
    case 'lineBreak':
    case 'pageBreak':
      return <br key={index} />;
    case 'subBreak':
      return <wbr key={index} />;
  }
}

function findActiveSyllableIndex(
  syllables: LyricSyllable[],
  activeTick: number | null,
): number {
  if (
    activeTick === null ||
    syllables.length === 0 ||
    activeTick < syllables[0]!.tick
  ) {
    return -1;
  }
  let lo = 0;
  let hi = syllables.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (syllables[mid]!.tick <= activeTick) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
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
    g.chords.length > 0 ||
    g.rehearsals.length > 0 ||
    g.phraseCount > 0 ||
    g.fingeringCount > 0 ||
    g.guitarVoicingCount > 0 ||
    g.guideTracks.length > 0 ||
    g.guitarInfos.length > 0 ||
    g.maxPhrases.length > 0;

  return (
    <div className="card">
      <h3>XF Style Message</h3>
      {showSummary && (
        <StyleSubSection title="概要">
          <div className="style-summary">
            {g.chords.length > 0 && <span>コード: {g.chords.length}</span>}
            {g.rehearsals.length > 0 && (
              <span>リハーサル: {g.rehearsals.length}</span>
            )}
            {g.guideTracks.length > 0 && (
              <span>ガイドトラック: {g.guideTracks.length}</span>
            )}
            {g.guitarInfos.length > 0 && (
              <span>ギター情報: {g.guitarInfos.length}</span>
            )}
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

      <StyleSubSection title={`イベント一覧 (${data.events.length})`}>
        <div className="style-list style-event-list">
          {data.events.map((ev, i) => (
            <div key={i} className="style-event-row">
              <span className="tick">{formatTick(ev.tick)}</span>
              <span className="style-kind">{STYLE_KIND_LABELS[ev.kind]}</span>
              <span>{formatStyleDetail(ev)}</span>
            </div>
          ))}
        </div>
      </StyleSubSection>
    </div>
  );
}

const STYLE_KIND_LABELS: Record<StyleMessage['kind'], string> = {
  chord: 'コード',
  rehearsal: 'リハーサル',
  phraseMark: 'フレーズ',
  maxPhraseMark: '最大フレーズ',
  fingering: '運指',
  guideTrack: 'ガイド',
  guitarInfo: 'ギター情報',
  guitarVoicing: '押弦',
};

function formatStyleDetail(ev: StyleMessage): string {
  switch (ev.kind) {
    case 'chord':
      return formatChord(ev.root, ev.type, ev.bass);
    case 'rehearsal':
      return `${ev.letter}${"'".repeat(ev.variation)}`;
    case 'phraseMark':
      return `${ev.hand === 'right' ? '右手' : '左手'}, CH ${
        ev.channel ?? '全'
      }, level ${ev.level}`;
    case 'maxPhraseMark':
      return `${ev.count} phrases`;
    case 'fingering':
      return `CH ${ev.channel}, note ${ev.noteNumber}, finger ${ev.fingering}, ${
        ev.hand === 'right' ? '右手' : '左手'
      }, ${ev.context}`;
    case 'guideTrack':
      return `右手: ${ev.rightHandChannel ?? 'なし'} / 左手: ${
        ev.leftHandChannel ?? 'なし'
      }`;
    case 'guitarInfo':
      return `${GUITAR_PART_LABELS[ev.part]} (CH ${
        ev.channel ?? '全'
      }), カポ ${ev.capo}, チューニング: ${ev.stringNotes.join(', ')}`;
    case 'guitarVoicing':
      return `CH ${ev.channel ?? '全'}, ${ev.strings
        .map((s, i) => `${i + 1}弦 fret ${s.fret} finger ${s.finger}`)
        .join(' / ')}`;
  }
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
