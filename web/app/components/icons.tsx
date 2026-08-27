/** The app's whole icon set, as inline SVG.
 *
 * A library would be a dependency and a network round trip for eighteen
 * shapes. These inherit `currentColor` and stroke width, so an icon always
 * matches the text next to it.
 */

type P = { className?: string };

const S = ({ className = "h-5 w-5", children }: P & { children: React.ReactNode }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const HomeIcon = (p: P) => (
  <S {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9.5" />
  </S>
);

export const CoachIcon = (p: P) => (
  <S {...p}>
    <path d="M12 3a7 7 0 0 1 7 7c0 2.3-1.1 3.7-2 4.8-.6.8-1 1.4-1 2.2v.5H8v-.5c0-.8-.4-1.4-1-2.2C6.1 13.7 5 12.3 5 10a7 7 0 0 1 7-7Z" />
    <path d="M9.5 21h5" />
  </S>
);

export const FoodieIcon = (p: P) => (
  <S {...p}>
    <path d="M7 3v8a3 3 0 0 0 6 0V3" />
    <path d="M10 3v18" />
    <path d="M17.5 3c1.6 1.6 2.5 3.7 2.5 6v3h-3v9" />
  </S>
);

export const UserIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="8" r="3.75" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </S>
);

export const PlusIcon = (p: P) => (
  <S {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
);

export const CameraIcon = (p: P) => (
  <S {...p}>
    <path d="M4 8.5h3l1.5-2.5h7L17 8.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </S>
);

export const MicIcon = (p: P) => (
  <S {...p}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5V21" />
  </S>
);

export const BarcodeIcon = (p: P) => (
  <S {...p}>
    <path d="M3 7V5.5a1.5 1.5 0 0 1 1.5-1.5H6M18 4h1.5A1.5 1.5 0 0 1 21 5.5V7M21 17v1.5a1.5 1.5 0 0 1-1.5 1.5H18M6 20H4.5A1.5 1.5 0 0 1 3 18.5V17" />
    <path d="M7 8v8M10 8v8M13.5 8v8M17 8v8" />
  </S>
);

export const PencilIcon = (p: P) => (
  <S {...p}>
    <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
    <path d="M14.5 6.5 17.5 9.5" />
  </S>
);

export const FlameIcon = ({ className = "h-5 w-5" }: P) => (
  <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
    <path d="M13.4 2.3c.3 2.6-.6 4.2-2 5.7-1.6 1.7-3.6 3.3-3.6 6.4A6.2 6.2 0 0 0 14 20.5c3-1 4.6-3.6 4.6-6.6 0-3.7-2.2-5.9-3.4-7.9-.6-1-1.2-2.2-1.8-3.7Z" />
    <path
      d="M11.2 12.6c.2 1.3-.4 2-.9 2.6-.5.6-.9 1.1-.9 2a2.6 2.6 0 0 0 2.3 2.6c1.3-.3 2.1-1.4 2.1-2.7 0-1.5-.9-2.4-1.5-3.2-.4-.5-.8-.8-1.1-1.3Z"
      fill="var(--surface)"
      opacity=".55"
    />
  </svg>
);

export const ChevronRight = (p: P) => (
  <S {...p}>
    <path d="M9 5l7 7-7 7" />
  </S>
);

export const ChevronDown = (p: P) => (
  <S {...p}>
    <path d="M5 9l7 7 7-7" />
  </S>
);

export const ArrowLeft = (p: P) => (
  <S {...p}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </S>
);

export const CloseIcon = (p: P) => (
  <S {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </S>
);

export const CheckIcon = (p: P) => (
  <S {...p}>
    <path d="M4.5 12.5l5 5 10-11" />
  </S>
);

export const TrashIcon = (p: P) => (
  <S {...p}>
    <path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5 7.5 20h9l1-13.5" />
  </S>
);

export const ScaleIcon = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
    <path d="M8 9.5a4 4 0 0 1 8 0" />
    <path d="M12 9.5 10.5 13" />
  </S>
);

export const BookIcon = (p: P) => (
  <S {...p}>
    <path d="M4 5.5A2 2 0 0 1 6 3.5h13v15H6a2 2 0 0 0-2 2v-15Z" />
    <path d="M4 18.5a2 2 0 0 1 2-2h13v4H6a2 2 0 0 1-2-2Z" />
  </S>
);

export const HistoryIcon = (p: P) => (
  <S {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.7-6.2" />
    <path d="M3.5 4.5V9h4.5" />
    <path d="M12 7.5V12l3 1.8" />
  </S>
);

export const CogIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 14.5a1.5 1.5 0 0 0 .3 1.7l.1.1a1.8 1.8 0 1 1-2.6 2.6l-.1-.1a1.5 1.5 0 0 0-2.5 1v.2a1.8 1.8 0 1 1-3.6 0v-.1a1.5 1.5 0 0 0-2.6-1l-.1.1a1.8 1.8 0 1 1-2.6-2.6l.1-.1a1.5 1.5 0 0 0-1-2.5h-.2a1.8 1.8 0 0 1 0-3.6h.1a1.5 1.5 0 0 0 1-2.6l-.1-.1a1.8 1.8 0 1 1 2.6-2.6l.1.1a1.5 1.5 0 0 0 2.5-1v-.2a1.8 1.8 0 1 1 3.6 0v.1a1.5 1.5 0 0 0 2.6 1l.1-.1a1.8 1.8 0 1 1 2.6 2.6l-.1.1a1.5 1.5 0 0 0 1 2.5h.2a1.8 1.8 0 1 1 0 3.6h-.1a1.5 1.5 0 0 0-1.4 1Z" />
  </S>
);

export const SparkIcon = (p: P) => (
  <S {...p}>
    <path d="M12 3.5 13.6 9 19 10.5 13.6 12 12 17.5 10.4 12 5 10.5 10.4 9Z" />
    <path d="M18.5 16.5 19 18.5l2 .5-2 .5-.5 2-.5-2-2-.5 2-.5Z" />
  </S>
);

export const SendIcon = (p: P) => (
  <S {...p}>
    <path d="M4.5 12 20 4.5 14.5 20l-3-6.5L4.5 12Z" />
  </S>
);

export const ImageIcon = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="3" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M4 17l4.5-4.5 4 4 3-2.5 4.5 4" />
  </S>
);

export const TrophyIcon = (p: P) => (
  <S {...p}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M7 5.5H4.5V7A3.5 3.5 0 0 0 7 10.4M17 5.5h2.5V7A3.5 3.5 0 0 1 17 10.4" />
    <path d="M12 14v3.5M8.5 20.5h7l-.7-3h-5.6l-.7 3Z" />
  </S>
);

export const LogoutIcon = (p: P) => (
  <S {...p}>
    <path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4" />
    <path d="M10 8.5 14 12l-4 3.5M14 12H4" />
  </S>
);
