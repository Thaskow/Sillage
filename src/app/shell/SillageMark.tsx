export function SillageMark({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      className="shrink-0 text-accent"
    >
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="8"
        fill="currentColor"
        opacity="0.14"
      />
      <path
        d="M6 20.5c3.2 0 4.6-2.6 7.6-2.6s4.4 2.6 7.6 2.6S25.8 18 26 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path
        d="M9 14.2c2.4 0 3.4-1.9 5.7-1.9s3.3 1.9 5.7 1.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}
