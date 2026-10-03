import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { usePlaybackPosition } from '../hooks/usePlaybackPosition.ts';
import type { MidiScheduler } from '../lib/player/scheduler.ts';
import type { KeyShiftChange } from '../lib/smf/fixedKey.ts';
import { formatTempo, formatTimeSignature } from '../lib/smf/metaEvents.ts';
import type { SmfMetaEvents } from '../lib/smf/metaEvents.ts';
import { secondsToTick } from '../lib/smf/playback.ts';
import type { PlaybackSequence } from '../lib/smf/playback.ts';
import { formatKeySignature, formatTickAsBarBeat } from '../lib/smf/timing.ts';
import type { SmfTiming } from '../lib/smf/timing.ts';
import type { Song } from '../lib/song.ts';
import type { FileSummary } from '../lib/songLoader.ts';
import { formatStyleDetail } from '../lib/xf/format.ts';
import { computeKaraokeSectionBreaks } from '../lib/xf/lyricSections.ts';
import type { LyricRun, LyricSyllable, LyricToken, ParsedKaraoke } from '../lib/xf/lyrics.ts';
import type {
  ChordMessage,
  RehearsalMessage,
  StyleMessage,
  VocalPart,
  XfData,
  XfInfoHeaderCommon,
  XfInfoHeaderLanguageSpecific,
  XfLyricsHeader,
  XfStyleData,
  XfVersion,
} from '../lib/xf/types.ts';
import { partColorOf } from '../lib/xf/vocalPart.ts';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { KaraokeView } from './KaraokeView.tsx';
import { LeadSheet } from './LeadSheet.tsx';

export type InfoPanelTab = 'leadSheet' | 'lyrics' | 'karaoke' | 'details';

type InfoPanelProps = {
  file: FileSummary | null;
  song: Song;
  activeTab: InfoPanelTab;
  scheduler: MidiScheduler;
  autoScrollLeadSheet?: boolean;
  autoScrollLyrics?: boolean;
  showPitchBar?: boolean;
  keyShifts: readonly KeyShiftChange[];
  playbackRate?: number;
};

export function InfoPanel(props: InfoPanelProps) {
  return (
    <section className="info-panel">
      <ErrorBoundary
        key={props.activeTab}
        fallback={(error) => (
          <div className="error" role="alert">
            <strong>このビューを表示できませんでした:</strong> {error.message}
          </div>
        )}
      >
        <ActiveView {...props} />
      </ErrorBoundary>
    </section>
  );
}

function ActiveView({
  file,
  song,
  activeTab,
  scheduler,
  autoScrollLeadSheet = true,
  autoScrollLyrics = true,
  showPitchBar = true,
  keyShifts,
  playbackRate = 1,
}: InfoPanelProps) {
  const { xf: data, karaoke: parsedKaraoke, chords, rehearsals, timing, sequence } = song;
  const { metaEvents } = song;
  const hasKaraoke = data.karaoke.header !== null || data.karaoke.events.length > 0;
  const hasStyle = data.style.events.length > 0;
  const empty =
    data.version === null &&
    data.commonHeader === null &&
    data.languageHeaders.length === 0 &&
    !hasKaraoke &&
    !hasStyle;

  if (empty) {
    return activeTab === 'details' ? (
      <div className="details-view">
        {file && <FileSection file={file} />}
        <SmfMetaSection events={metaEvents} timing={timing} />
        <div className="card">
          <p className="muted">XFデータは含まれていません</p>
        </div>
      </div>
    ) : (
      <EmptyView title="表示できるXFデータはありません" />
    );
  }

  const showChart =
    chords.length > 0 || rehearsals.length > 0 || parsedKaraoke.syllables.length > 0;

  return (
    <>
      {activeTab === 'leadSheet' &&
        (showChart ? (
          <LeadSheet
            chords={chords}
            rehearsals={rehearsals}
            syllables={parsedKaraoke.syllables}
            timing={timing}
            sequence={sequence}
            scheduler={scheduler}
            autoScroll={autoScrollLeadSheet}
            keyShifts={keyShifts}
          />
        ) : (
          <EmptyView title="リードシート情報はありません" />
        ))}

      {activeTab === 'lyrics' &&
        (hasKaraoke && parsedKaraoke.tokens.length > 0 ? (
          <KaraokeSection
            parsed={parsedKaraoke}
            rehearsals={rehearsals}
            scheduler={scheduler}
            sequence={sequence}
            autoScroll={autoScrollLyrics}
          />
        ) : (
          <EmptyView title="歌詞情報はありません" />
        ))}

      {activeTab === 'karaoke' &&
        (hasKaraoke && parsedKaraoke.syllables.length > 0 ? (
          <KaraokeView
            pages={song.karaokePages}
            pitchLane={showPitchBar ? song.pitchLane : null}
            nonLyricDurations={song.nonLyricDurations}
            playbackRate={playbackRate}
            sequence={sequence}
            scheduler={scheduler}
          />
        ) : (
          <EmptyView title="歌詞情報はありません" />
        ))}

      {activeTab === 'details' && (
        <DetailsView
          file={file}
          metaEvents={metaEvents}
          data={data}
          timing={timing}
          hasStyle={hasStyle}
        />
      )}
    </>
  );
}

function DetailsView({
  file,
  metaEvents,
  data,
  timing,
  hasStyle,
}: {
  file: FileSummary | null;
  metaEvents: SmfMetaEvents;
  data: XfData;
  timing: SmfTiming;
  hasStyle: boolean;
}) {
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="details-view">
      {file && <FileSection file={file} />}
      <SmfMetaSection events={metaEvents} timing={timing} />
      {data.version && <VersionSection version={data.version} />}
      {data.commonHeader && <CommonSection header={data.commonHeader} />}
      {data.languageHeaders.map((h, i) => (
        <LanguageSection key={`${h.language}-${i}`} header={h} />
      ))}
      {data.karaoke.header && <KaraokeMetaSection header={data.karaoke.header} />}
      {hasStyle && <StyleSection data={data.style} timing={timing} />}
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
        <Field label="ファイル名" value={file.name} />
        <Field label="サイズ" value={`${file.size.toLocaleString()} bytes`} />
        <Field label="更新日時" value={new Date(file.lastModified).toLocaleString()} />
      </FieldList>
    </div>
  );
}

function SmfMetaSection({ events, timing }: { events: SmfMetaEvents; timing: SmfTiming }) {
  return (
    <div className="card">
      <h3>SMF Meta-Event</h3>
      <FieldList>
        <Field label="曲名" value={events.trackName ?? '（なし）'} />
        <MetaEventField
          label="拍子"
          events={events.timeSignatures}
          format={formatTimeSignature}
          timing={timing}
        />
        <MetaEventField
          label="テンポ"
          events={events.tempos}
          format={(ev) => formatTempo(ev.microsecondsPerQuarter)}
          timing={timing}
        />
        <MetaEventField
          label="調性情報"
          events={events.keySignatures}
          format={(ev) => formatKeySignature(ev.signature)}
          timing={timing}
        />
      </FieldList>
    </div>
  );
}

function MetaEventField<T extends { tick: number }>({
  label,
  events,
  format,
  timing,
}: {
  label: string;
  events: readonly T[];
  format: (ev: T) => string;
  timing: SmfTiming;
}) {
  return (
    <div className="info-row meta-event-row">
      <dt>{label}</dt>
      {events.length === 0 ? (
        <dd>（なし）</dd>
      ) : (
        <dd className="style-list meta-event-list">
          {events.map((ev, i) => (
            <div key={i} className="style-list-row">
              <span className="tick">{formatTickAsBarBeat(ev.tick, timing)}</span>
              <span>{format(ev)}</span>
            </div>
          ))}
        </dd>
      )}
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
      <h3>XF Version ID</h3>
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

const COMMON_FIELDS: ReadonlyArray<readonly [Exclude<keyof XfInfoHeaderCommon, 'kind'>, string]> = [
  ['date', '発表年月日'],
  ['country', '制作地'],
  ['category', '曲のジャンル'],
  ['beat', 'リズムのビート'],
  ['instrumentOnMelody', 'メロディパートの主な楽器'],
  ['vocalType', '歌唱タイプ'],
  ['composer', '作曲者'],
  ['lyricist', '作詞者'],
  ['arranger', '編曲者'],
  ['performer', '演奏者／歌唱者'],
  ['programmer', '楽曲データ制作者'],
  ['keyword', 'キーワード'],
];

function CommonSection({ header }: { header: XfInfoHeaderCommon }) {
  return (
    <div className="card">
      <h3>XF Information Header (Common)</h3>
      <FieldList>
        {COMMON_FIELDS.map(([key, label]) => {
          const value = header[key];
          return value === undefined ? null : <Field key={key} label={label} value={value} />;
        })}
      </FieldList>
    </div>
  );
}

const LANG_FIELDS: ReadonlyArray<
  readonly [Exclude<keyof XfInfoHeaderLanguageSpecific, 'kind'>, string]
> = [
  ['language', '言語情報'],
  ['songName', '曲名'],
  ['composer', '作曲者'],
  ['lyricist', '作詞者'],
  ['arranger', '編曲者'],
  ['performer', '演奏者／歌唱者'],
  ['programmer', '楽曲データ制作者'],
];

function LanguageSection({ header }: { header: XfInfoHeaderLanguageSpecific }) {
  return (
    <div className="card">
      <h3>XF Information Header (Language Specific)</h3>
      <FieldList>
        {LANG_FIELDS.map(([key, label]) => {
          const value = header[key];
          return value === undefined ? null : <Field key={key} label={label} value={value} />;
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
  scheduler,
  sequence,
  autoScroll,
}: {
  parsed: ParsedKaraoke;
  rehearsals: RehearsalMessage[];
  scheduler: MidiScheduler;
  sequence: PlaybackSequence;
  autoScroll: boolean;
}) {
  const { replaceWithDivider, dividerBefore } = computeKaraokeSectionBreaks(
    parsed.tokens,
    rehearsals,
  );
  const activeSyllableIndex = usePlaybackPosition(scheduler, (seconds) =>
    findActiveSyllableIndex(parsed.syllables, secondsToTick(seconds, sequence)),
  );
  const blocks = buildKaraokeBlocks(
    parsed.tokens,
    replaceWithDivider,
    dividerBefore,
    activeSyllableIndex,
  );
  const streamRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    const behavior = mountedRef.current ? 'smooth' : 'instant';
    mountedRef.current = true;
    if (!autoScroll) return;
    if (activeSyllableIndex < 0) return;
    const el = streamRef.current?.querySelector('.lyric--active');
    if (!el) return;
    // WebKit's scrollIntoView targets a different box for spans containing ruby.
    const rect = el.getBoundingClientRect();
    window.scrollTo({
      top: window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2,
      behavior,
    });
  }, [activeSyllableIndex, autoScroll]);

  return (
    <div className="card">
      {blocks.length > 0 && (
        <div className="karaoke-stream" ref={streamRef}>
          {blocks.flatMap((block, idx) => {
            if (block.kind === 'divider') {
              return [<hr key={`div-${idx}`} className="karaoke-section-break" />];
            }
            return [
              <div key={`bc-${idx}`} className="karaoke-badge-cell">
                {block.part !== null && (
                  <span className={`part-badge part-badge--${partColorOf(block.part)}`}>
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
  { kind: 'divider' } | { kind: 'lyrics'; part: VocalPart | null; tokens: ReactNode[] };

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
      const partForBlock = activePart !== null && activePart !== displayedPart ? activePart : null;
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
    const isActiveSyllable = isSyllable && syllableCounter === activeSyllableIndex;
    const isPassedSyllable = isSyllable && syllableCounter <= activeSyllableIndex;
    currentContent.push(renderToken(tok, i, isPassedSyllable, isActiveSyllable));
    if (isSyllable) {
      lastEmitted = 'inline';
      syllableCounter += 1;
    }
  }

  flushLyrics();
  return blocks;
}

function KaraokeHeaderInfo({ header }: { header: XfLyricsHeader }) {
  return (
    <FieldList>
      <Field
        label="メロディパートのMIDIチャンネル"
        value={header.melodyChannels.length > 0 ? header.melodyChannels.join(', ') : '（なし）'}
      />
      <Field label="歌詞表示オフセット値" value={header.displayOffset} />
      <Field label="言語情報" value={header.language ?? '（未指定 / Latin-1）'} />
    </FieldList>
  );
}

function KaraokeMetaSection({ header }: { header: XfLyricsHeader }) {
  return (
    <div className="card">
      <h3>XF Karaoke Message</h3>
      <KaraokeHeaderInfo header={header} />
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

function findActiveSyllableIndex(syllables: LyricSyllable[], activeTick: number | null): number {
  if (activeTick === null || syllables.length === 0 || activeTick < syllables[0]!.tick) {
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

type GuideTrackMsg = Extract<StyleMessage, { kind: 'guideTrack' }>;
type GuitarInfoMsg = Extract<StyleMessage, { kind: 'guitarInfo' }>;
type MaxPhraseMsg = Extract<StyleMessage, { kind: 'maxPhraseMark' }>;

interface StyleGroups {
  chords: ChordMessage[];
  rehearsals: RehearsalMessage[];
  phraseCount: number;
  maxPhrases: MaxPhraseMsg[];
  fingeringCount: number;
  guideTracks: GuideTrackMsg[];
  guitarInfos: GuitarInfoMsg[];
  guitarVoicingCount: number;
}

function partitionStyle(events: StyleMessage[]): StyleGroups {
  const chords: ChordMessage[] = [];
  const rehearsals: RehearsalMessage[] = [];
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

function StyleSection({ data, timing }: { data: XfStyleData; timing: SmfTiming }) {
  const g = partitionStyle(data.events);
  const formatTick = (tick: number): string => formatTickAsBarBeat(tick, timing);
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
            {g.chords.length > 0 && <span>コード名: {g.chords.length}</span>}
            {g.rehearsals.length > 0 && <span>リハーサルマーク: {g.rehearsals.length}</span>}
            {g.phraseCount > 0 && <span>フレーズマーク: {g.phraseCount}</span>}
            {g.maxPhrases[0] && <span>最大フレーズ数: {g.maxPhrases[0].maxPhraseCount}</span>}
            {g.guideTracks.length > 0 && <span>ガイドトラックフラグ: {g.guideTracks.length}</span>}
            {g.guitarInfos.length > 0 && (
              <span>ギターインフォメーションフラグ: {g.guitarInfos.length}</span>
            )}
            {g.guitarVoicingCount > 0 && (
              <span>ギター用コードヴォイシング: {g.guitarVoicingCount}</span>
            )}
            {g.fingeringCount > 0 && <span>運指番号: {g.fingeringCount}</span>}
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
  chord: 'コード名',
  rehearsal: 'リハーサルマーク',
  phraseMark: 'フレーズマーク',
  maxPhraseMark: '最大レベル8フレーズマーク',
  guideTrack: 'ガイドトラックフラグ',
  guitarInfo: 'ギターインフォメーションフラグ',
  guitarVoicing: 'ギター用コードヴォイシング',
  fingering: '運指番号',
};

function StyleSubSection({ title, children }: { title: string; children: ReactNode }) {
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
