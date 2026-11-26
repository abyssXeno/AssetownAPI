export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-label="Assetown" role="img">
      <defs>
        <linearGradient id="admin-logo-a" x1="8" y1="6" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#B79BFF" />
          <stop offset="0.55" stopColor="#7C5CFF" />
          <stop offset="1" stopColor="#3E86FF" />
        </linearGradient>
      </defs>
      <path d="M32 3.5 58.5 18.6v26.8L32 60.5 5.5 45.4V18.6L32 3.5Z" fill="url(#admin-logo-a)" stroke="rgba(255,255,255,.22)" />
      <path d="M32 12.5 50 22.4v19.2L32 51.5 14 41.6V22.4L32 12.5Z" fill="#0B0B14" />
      <path d="M32 19.5 41.5 43h-5.2l-1.9-5h-4.8l-1.9 5h-5.2L32 19.5Zm0 8.3-1.5 4.6h3l-1.5-4.6Z" fill="url(#admin-logo-a)" />
    </svg>
  );
}
