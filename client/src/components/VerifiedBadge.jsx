import React, { useEffect, useId, useRef, useState } from 'react';

const ADMIN_BADGE_LABEL = 'Admin of PyCollab';
const BADGE_CHECK_PATH = 'M8.75 12.25L11.2 14.7L15.55 9.2';

const VerifiedBadge = ({ size = 16, style = {} }) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const gradientId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) {
        setOpen(false);
      }
    };

    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <span
      ref={wrapperRef}
      className="verified-badge"
      style={{ '--badge-size': `${size}px`, ...style }}
    >
      <button
        type="button"
        className="verified-badge-trigger"
        aria-label={ADMIN_BADGE_LABEL}
        aria-expanded={open}
        title={ADMIN_BADGE_LABEL}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#A9BA97" />
              <stop offset="1" stopColor="#728263" />
            </linearGradient>
          </defs>
          <circle cx="12" cy="12" r="9.25" fill={`url(#${gradientId})`} />
          <circle
            cx="12"
            cy="12"
            r="9.25"
            fill="none"
            stroke="rgba(247, 247, 242, 0.42)"
            strokeWidth="0.9"
          />
          <circle cx="12" cy="12" r="8.2" fill="none" stroke="rgba(18, 17, 19, 0.12)" strokeWidth="0.65" />
          <path
            d={BADGE_CHECK_PATH}
            fill="none"
            stroke="#F7F7F2"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open && (
        <span className="verified-badge-popover" role="status">
          {ADMIN_BADGE_LABEL}
        </span>
      )}
    </span>
  );
};

export default VerifiedBadge;
