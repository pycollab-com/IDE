export function Skeleton({ className = "", style, rounded = false }) {
  return (
    <span
      className={`skeleton${rounded ? " skeleton-round" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ lines = 1, className = "" }) {
  return (
    <div className={`skeleton-text${className ? ` ${className}` : ""}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} className="skeleton-text-line" style={{ "--line-index": index }} />
      ))}
    </div>
  );
}
