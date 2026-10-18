// A small hand-drawn (well — hand-coded) illustration: an open book with a
// stack beside it. Kept as plain shapes so there's no external image or
// licensing question, just something friendlier than empty space.
export default function BooksIllustration() {
  return (
    <svg
      className="hero-illustration"
      viewBox="0 0 220 160"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* stack of books */}
      <rect x="10" y="118" width="70" height="14" rx="3" fill="rgba(255,255,255,0.85)" />
      <rect x="16" y="104" width="58" height="14" rx="3" fill="rgba(255,255,255,0.65)" />
      <rect x="22" y="90" width="46" height="14" rx="3" fill="rgba(255,255,255,0.45)" />

      {/* open book */}
      <path
        d="M95 130 L95 55 C95 50 100 47 105 49 L138 62 L138 137 L105 124 C100 122 95 126 95 130 Z"
        fill="white"
      />
      <path
        d="M180 130 L180 55 C180 50 175 47 170 49 L138 62 L138 137 L170 124 C175 122 180 126 180 130 Z"
        fill="rgba(255,255,255,0.85)"
      />
      <line x1="106" y1="70" x2="128" y2="78" stroke="rgba(108,79,240,0.35)" strokeWidth="3" strokeLinecap="round" />
      <line x1="106" y1="82" x2="128" y2="90" stroke="rgba(108,79,240,0.35)" strokeWidth="3" strokeLinecap="round" />
      <line x1="106" y1="94" x2="128" y2="102" stroke="rgba(108,79,240,0.25)" strokeWidth="3" strokeLinecap="round" />
      <line x1="150" y1="78" x2="172" y2="70" stroke="rgba(63,174,85,0.35)" strokeWidth="3" strokeLinecap="round" />
      <line x1="150" y1="90" x2="172" y2="82" stroke="rgba(63,174,85,0.35)" strokeWidth="3" strokeLinecap="round" />
      <line x1="150" y1="102" x2="172" y2="94" stroke="rgba(63,174,85,0.25)" strokeWidth="3" strokeLinecap="round" />

      {/* little sparkles */}
      <circle cx="195" cy="35" r="4" fill="rgba(255,255,255,0.8)" />
      <circle cx="205" cy="55" r="2.5" fill="rgba(255,255,255,0.6)" />
      <circle cx="30" cy="45" r="3" fill="rgba(255,255,255,0.6)" />
    </svg>
  );
}