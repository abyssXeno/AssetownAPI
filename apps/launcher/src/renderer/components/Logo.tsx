interface LogoProps {
  size?: number;
  className?: string;
}

/** Monogramme Assetown — « A » facetté dans un losange lumineux. */
export function Logo({ size = 32, className }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={className}
      aria-label="Assetown"
      role="img"
    >
      <defs>
        <linearGradient id="assetown-logo-a" x1="8" y1="6" x2="56" y2="60" gradientUnits="userSpaceOnUse">
          <stop stopColor="#B79BFF" />
          <stop offset="0.55" stopColor="#7C5CFF" />
          <stop offset="1" stopColor="#3E86FF" />
        </linearGradient>
        <linearGradient id="assetown-logo-b" x1="20" y1="18" x2="46" y2="52" gradientUnits="userSpaceOnUse">
          <stop stopColor="#0A0A12" />
          <stop offset="1" stopColor="#14142A" />
        </linearGradient>
      </defs>
      <path
        d="M32 3.5 58.5 18.6v26.8L32 60.5 5.5 45.4V18.6L32 3.5Z"
        fill="url(#assetown-logo-a)"
        stroke="rgba(255,255,255,0.22)"
        strokeWidth="1"
      />
      <path d="M32 12.5 50 22.4v19.2L32 51.5 14 41.6V22.4L32 12.5Z" fill="url(#assetown-logo-b)" />
      <path d="M32 19.5 41.5 43h-5.2l-1.9-5h-4.8l-1.9 5h-5.2L32 19.5Zm0 8.3-1.5 4.6h3l-1.5-4.6Z" fill="url(#assetown-logo-a)" />
      <circle cx="47.5" cy="17" r="2.4" fill="#C9B8FF" opacity="0.9" />
    </svg>
  );
}
