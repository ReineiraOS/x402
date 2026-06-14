/* Brand wordmark — the Reineira dragon logo. `size` is the rendered HEIGHT in px
   (the asset is 2839×474 ≈ 5.99:1). It is a silver + blue mark on transparent,
   authored for dark surfaces; the `.brand-logo` class (tokens.css) darkens it just
   enough to stay legible on the light theme and leaves it untouched on dark. */
export function Wordmark({ size = 24 }: { size?: number }) {
  const width = Math.round((2839 / 474) * size)
  return (
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
