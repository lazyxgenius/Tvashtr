/**
 * The landing's videos (landing-1.md §8): a native <video> with a poster and `preload="none"`, so
 * nothing downloads before a press. One plays at a time, and it pauses when scrolled out of view.
 */
import { Play, X } from "lucide-react";
import { type RefObject, useEffect, useRef, useState } from "react";

import { IconButton } from "../../design-system/components";
import { useModalDialog } from "../../lib/useModalDialog";
import type { Media } from "./media";
import { useScrollLock } from "./useScrollLock";

let playing: HTMLVideoElement | null = null;

function onlyThisOne(video: HTMLVideoElement): void {
  if (playing && playing !== video) playing.pause();
  playing = video;
}

function usePauseOutOfView(ref: RefObject<HTMLVideoElement | null>): void {
  useEffect(() => {
    const video = ref.current;
    if (!video || typeof IntersectionObserver === "undefined") return;
    const seen = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) video.pause();
      },
      { threshold: 0.2 },
    );
    seen.observe(video);
    return () => seen.disconnect();
  }, [ref]);
}

/** Our large play button over the poster; once it plays, the browser's own controls and sound. */
export function PosterVideo({
  media,
  label,
  videoRef,
}: {
  media: Media;
  label: string;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const [started, setStarted] = useState(false);
  usePauseOutOfView(videoRef);
  return (
    <div className="web-video">
      <video
        ref={videoRef}
        className="web-video__el"
        src={media.src}
        poster={media.poster}
        preload="none"
        playsInline
        controls={started}
        onPlay={(e) => {
          onlyThisOne(e.currentTarget);
          setStarted(true);
        }}
      />
      {!started && (
        <button
          type="button"
          className="web-video__play"
          aria-label={label}
          onClick={() => playWithSound(videoRef.current)}
        >
          <span className="web-video__disc">
            <Play size={30} strokeWidth={1.6} aria-hidden />
          </span>
        </button>
      )}
    </div>
  );
}

function playWithSound(video: HTMLVideoElement | null): void {
  if (!video) return;
  video.muted = false;
  void video.play();
}

/** The hero's "Watch the demo": bring the player into view and start it, in the same press. */
export function watch(video: HTMLVideoElement | null): void {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  video?.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: "center" });
  playWithSound(video);
}

/** The secondary video, in a lightbox with its captions on. Escape or Close returns to the page. */
export function VideoDialog({
  media,
  title,
  onClose,
}: {
  media: Media;
  title: string;
  onClose: () => void;
}) {
  const ref = useModalDialog<HTMLDivElement>(true, onClose);
  const video = useRef<HTMLVideoElement>(null);
  useScrollLock();
  useEffect(() => playWithSound(video.current), []);
  return (
    <>
      <div className="web-lightbox__scrim" onClick={onClose} />
      <div ref={ref} className="web-lightbox" role="dialog" aria-modal="true" aria-label={title}>
        <div className="web-lightbox__bar">
          <span>{title}</span>
          <IconButton size="md" aria-label="Close video" onClick={onClose}>
            <X size={16} strokeWidth={1.6} aria-hidden />
          </IconButton>
        </div>
        <video
          ref={video}
          className="web-video__el"
          src={media.src}
          poster={media.poster}
          preload="none"
          playsInline
          controls
          onPlay={(e) => onlyThisOne(e.currentTarget)}
        >
          {media.captions && (
            <track kind="captions" srcLang="en" label="English" src={media.captions} default />
          )}
        </video>
      </div>
    </>
  );
}
