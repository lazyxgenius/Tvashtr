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
