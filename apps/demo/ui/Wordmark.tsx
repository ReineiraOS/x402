/* Brand logo — the real Reineira dragon wordmark, ported from
   platform-web-landing-app (its <LogoWithText> uses this same
   /logos/reineira-logo.png, 2839×474 ≈ 5.99:1). `size` is the rendered HEIGHT
   in px. The asset is a silver + blue mark on transparent, authored for dark
   surfaces; the `.brand-logo` class (tokens.css) darkens it just enough to stay
   legible on the light theme, and leaves it untouched on dark. */
export function Wordmark({ size = 24 }: { size?: number }) {
  const width = Math.round((2839 / 474) * size)
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/logos/reineira-logo.png"
      alt="ReineiraOS"
      width={width}
      height={size}
      className="brand-logo"
      style={{ height: size, width, display: 'block' }}
    />
  )
}
