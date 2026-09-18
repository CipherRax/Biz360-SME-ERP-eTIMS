import { useEffect, useState } from 'react';
import { md5 } from '@/lib/utils/md5';

type Stage = 'uploaded' | 'gravatar' | 'initials';

interface UserAvatarProps {
  name: string;
  email?: string | null;
  src?: string | null;
  size?: number;
  className?: string;
}

/**
 * Avatar with a graceful fallback chain:
 * 1. uploaded profile image (src)
 * 2. Gravatar lookup keyed to the account email (covers Gmail addresses)
 * 3. initials circle
 *
 * The Gravatar stage probes with `d=404` so a missing account is caught by
 * the <img> onError handler and drops through to initials without a flicker.
 */
export function UserAvatar({ name, email, src, size = 40, className = '' }: UserAvatarProps) {
  const [stage, setStage] = useState<Stage>('uploaded');

  useEffect(() => {
    setStage('uploaded');
  }, [email, src]);

  const styles = { width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) };

  if (stage === 'uploaded' && src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote avatar with onError fallback not supported by next/image
      <img
        src={src}
        alt={`${name} profile`}
        style={styles}
        onError={() => setStage('gravatar')}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }

  if (stage === 'gravatar' && email) {
    const hash = md5(email.trim().toLowerCase());
    const gravatarUrl = `https://www.gravatar.com/avatar/${hash}?d=404&s=${size * 2}`;
    return (
      // eslint-disable-next-line @next/next/no-img-element -- onError-driven fallback probe; next/image can't hook load errors
      <img
        src={gravatarUrl}
        alt={`${name} profile`}
        style={styles}
        onError={() => setStage('initials')}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={styles}
      className={`inline-flex shrink-0 items-center justify-center rounded-full bg-brand-soft font-bold tracking-tight text-brand-deep ${className}`}
    >
      {initials(name) || '—'}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}