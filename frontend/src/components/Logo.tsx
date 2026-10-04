/** Docker whale logo (webp with png fallback), served from /public. */
export default function Logo({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <picture className={`shrink-0 ${className}`}>
      <source srcSet="/docker.webp" type="image/webp" />
      <img
        src="/docker.png"
        alt="DockerUpdates"
        width={size}
        height={Math.round(size * (404 / 512))}
        draggable={false}
        className="block select-none"
      />
    </picture>
  )
}
