import { useState } from 'react';
import { colorFor, initials } from '../lib/format';

export function Avatar({ name, address, src, size = 40 }: { name?: string; address: string; src?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const label = name || address;
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42, background: colorFor(address) }} aria-hidden="true">
      {src && !failed ? <img src={src} alt="" onError={() => setFailed(true)} /> : initials(label)}
    </span>
  );
}
