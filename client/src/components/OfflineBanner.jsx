export default function OfflineBanner({ hostedOnline, localOnline }) {
  if (hostedOnline == null || localOnline == null) return null;
  if (hostedOnline && localOnline) return null;

  const message = !localOnline
    ? "The desktop service is unavailable. Local copies and cached projects may not load."
    : "Hosted services are unavailable. Reconnect to continue with shared projects.";

  return (
    <div className="offline-banner" role="status">
      {message}
    </div>
  );
}
