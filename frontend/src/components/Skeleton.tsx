"use client";

import React from "react";

type Props = {
  className?: string;
};

export default function Skeleton({ className = "" }: Props) {
  return <div className={`animate-pulse rounded bg-gray-700/40 ${className}`} />;
}

