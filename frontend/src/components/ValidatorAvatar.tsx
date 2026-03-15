"use client";

import { useState } from "react";
import Avatar from "boring-avatars";

interface ValidatorAvatarProps {
  address: string;
  avatarUrl?: string;
  size?: number;
}

const PALETTE = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#4f46e5"];

export default function ValidatorAvatar({ address, avatarUrl, size = 48 }: ValidatorAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  if (avatarUrl && !imgFailed) {
    return (
      <img
        src={avatarUrl}
        alt="Validator avatar"
        width={size}
        height={size}
        className="rounded-full object-cover ring-2 ring-white/10 shrink-0"
        style={{ width: size, height: size }}
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <div className="rounded-full ring-2 ring-white/10 overflow-hidden shrink-0" style={{ width: size, height: size }}>
      <Avatar name={address} variant="beam" size={size} colors={PALETTE} />
    </div>
  );
}
