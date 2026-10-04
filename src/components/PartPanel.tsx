import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { usePlaybackPosition } from '../hooks/usePlaybackPosition.ts';
import { bottomCover } from '../lib/layout/panelCover.ts';
import { isChannelAudible } from '../lib/player/channelMask.ts';
import type { MidiScheduler } from '../lib/player/scheduler.ts';
import { activeVoiceIndex } from '../lib/smf/channelVoices.ts';
import type { ChannelPart } from '../lib/smf/channelVoices.ts';
import { voiceName } from '../lib/xg/voiceNames.ts';

interface PartPanelProps {
  id: string;
  parts: readonly ChannelPart[];
  melodyChannels: readonly number[];
  scheduler: MidiScheduler;
  onClose: () => void;
}

const NO_SOUND = 'No Sound';

export function PartPanel({ id, parts, melodyChannels, scheduler, onClose }: PartPanelProps) {
  const { mutedChannels, soloChannels } = useSyncExternalStore(
    scheduler.subscribe,
    scheduler.getState,
  );
  const voiceKey = usePlaybackPosition(scheduler, (seconds) =>
    parts.map((part) => activeVoiceIndex(part, seconds)).join(','),
  );
  const names = useMemo(() => {
    const indices = voiceKey.split(',').map(Number);
    return parts.map((part, i) => voiceName(part.voices[indices[i] ?? 0]!));
  }, [parts, voiceKey]);
  const melody = useMemo(() => new Set(melodyChannels.map((ch) => ch - 1)), [melodyChannels]);
  const hasMask = mutedChannels !== 0 || soloChannels !== 0;

  const panelRef = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    const el = panelRef.current;
    const root = document.documentElement;
    if (!el) return;
    const update = () => {
      const cover = bottomCover(el.getBoundingClientRect(), window.innerHeight);
      const chrome = document.querySelector('.viewer-chrome')?.getBoundingClientRect().bottom ?? 0;
      root.style.setProperty('--part-panel-cover', `${cover}px`);
      root.style.setProperty('--part-panel-top-inset', `${cover > 0 ? chrome : 0}px`);
    };
    update();
    // Wait a frame for the dock's observer to update --dock-height.
    let frame = 0;
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(el);
    const dock = document.querySelector('.player-dock');
    if (dock) observer.observe(dock);
    window.addEventListener('resize', scheduleUpdate);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', scheduleUpdate);
      root.style.removeProperty('--part-panel-cover');
      root.style.removeProperty('--part-panel-top-inset');
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('dialog[open]')) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <section id={id} ref={panelRef} className="part-panel" aria-labelledby={`${id}-title`}>
      <header className="part-panel-header">
        <h2 id={`${id}-title`} className="part-panel-title">
          パート
        </h2>
        <button
          type="button"
          className="part-panel-clear"
          disabled={!hasMask}
          onClick={() => scheduler.clearChannelMasks()}
        >
          すべて解除
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="閉じる"
          title="閉じる"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </header>
      <ul className="part-list">
        {parts.map((part, i) => {
          const { channel } = part;
          const bit = 1 << channel;
          const label = `チャンネル ${channel + 1}`;
          const audible = isChannelAudible(mutedChannels, soloChannels, channel);
          return (
            <li key={channel} className={audible ? 'part-row' : 'part-row part-row--silent'}>
              <span className="part-channel">{channel + 1}</span>
              <span
                className={names[i] === null ? 'part-voice part-voice--none' : 'part-voice'}
                title={names[i] ?? NO_SOUND}
              >
                {names[i] ?? NO_SOUND}
              </span>
              {melody.has(channel) && <span className="part-melody">メロディ</span>}
              <button
                type="button"
                className="part-toggle part-toggle--mute"
                aria-pressed={(mutedChannels & bit) !== 0}
                aria-label={`${label} をミュート`}
                title="ミュート"
                onClick={() => scheduler.toggleMute(channel)}
              >
                M
              </button>
              <button
                type="button"
                className="part-toggle part-toggle--solo"
                aria-pressed={(soloChannels & bit) !== 0}
                aria-label={`${label} をソロ`}
                title="ソロ"
                onClick={() => scheduler.toggleSolo(channel)}
              >
                S
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6 18 18" />
      <path d="M18 6 6 18" />
    </svg>
  );
}
