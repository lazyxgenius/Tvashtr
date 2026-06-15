// Shared inline line-icons (Lucide-style, 1.6px stroke) for the UI kits.
const TvIcons = (() => {
  const S = ({ children, size = 20, sw = 1.6, ...p }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>
      {children}
    </svg>
  );
  return {
    Plus: (p) => <S {...p}><path d="M12 5v14M5 12h14" /></S>,
    Search: (p) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></S>,
    ArrowUp: (p) => <S {...p}><path d="M12 19V5M6 11l6-6 6 6" /></S>,
    Paperclip: (p) => <S {...p}><path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9.7 18a1.7 1.7 0 0 1-2.4-2.4l7.8-7.8" /></S>,
    Message: (p) => <S {...p}><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-4-1L3 20l1.1-4.9a8.4 8.4 0 0 1 16.9-3.6Z" /></S>,
    Settings: (p) => <S {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9Z" /></S>,
    More: (p) => <S {...p}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></S>,
    Pen: (p) => <S {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></S>,
    Sparkles: (p) => <S {...p}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6Z" /><path d="M19 14l.7 1.9L21.5 17l-1.8.6L19 19.5l-.7-1.9L16.5 17l1.8-.6Z" /></S>,
    Check: (p) => <S {...p}><path d="M20 6 9 17l-5-5" /></S>,
    Chevron: (p) => <S {...p}><path d="m6 9 6 6 6-6" /></S>,
    Folder: (p) => <S {...p}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></S>,
    Terminal: (p) => <S {...p}><path d="m4 17 6-5-6-5M12 19h8" /></S>,
    Book: (p) => <S {...p}><path d="M2 4.5A2.5 2.5 0 0 1 4.5 2H20v17H4.5A2.5 2.5 0 0 0 2 21.5Z" /><path d="M2 21.5V4.5" /></S>,
    Compass: (p) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5Z" /></S>,
    Layout: (p) => <S {...p}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 21V9" /></S>,
    Copy: (p) => <S {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></S>,
    Refresh: (p) => <S {...p}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></S>,
    ThumbUp: (p) => <S {...p}><path d="M7 10v11M2 13v6a2 2 0 0 0 2 2h13.3a2 2 0 0 0 2-1.7l1.3-7a2 2 0 0 0-2-2.3H14l1-5a2 2 0 0 0-2-2L7 10" /></S>,
    Arrow: (p) => <S {...p}><path d="M5 12h14M13 6l6 6-6 6" /></S>,
  };
})();
window.TvIcons = TvIcons;
