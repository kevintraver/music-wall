"use client";

import React from "react";

type Props = {
  className?: string;
  style?: React.CSSProperties;
};

export default function Skeleton({ className = "", style }: Props) {
  return <div className={`animate-pulse rounded bg-gray-700/40 ${className}`} style={style} />;
}
