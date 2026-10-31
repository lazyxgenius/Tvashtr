/** The landing's self-hosted videos (frontend/public/media), one place for every file name. */
export interface Media {
  src: string;
  poster: string;
  /** Only the 2-minute demo has a captions file: Reel 1's captions are burned in. */
  captions?: string;
}

export const REEL: Media = {
  src: "/media/reel-1.mp4",
  poster: "/media/reel-1-poster.webp",
};

export const DEMO: Media = {
  src: "/media/demo-2min.mp4",
  poster: "/media/demo-2min-poster.webp",
  captions: "/media/demo-2min.en.vtt",
};

export function playWithSound(video: HTMLVideoElement | null): void {
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
