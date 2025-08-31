"use client";

import React, { useEffect, useRef } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
}

function AddAlbumModal({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-album-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={dialogRef}
        className="relative bg-white w-full max-w-lg rounded-xl shadow-2xl p-6 mx-4"
      >
        <div className="flex items-start justify-between mb-4">
          <h2 id="add-album-title" className="text-xl font-semibold text-gray-900">
            Add Album
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-500 hover:text-gray-700"
          >
            ✕
          </button>
        </div>
        <div className="space-y-3 text-gray-700">
          <p>
            Album adding will be available here soon. This modal will let you
            paste a Spotify Album URL or ID, preview details, and confirm.
          </p>
          <ul className="list-disc pl-5 text-sm text-gray-600">
            <li>Paste album link or ID</li>
            <li>Confirm metadata and artwork</li>
            <li>Save to wall and broadcast via WebSocket</li>
          </ul>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-900"
          >
            Close
          </button>
          <button
            disabled
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white opacity-60 cursor-not-allowed"
            title="Coming soon"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

export default React.memo(AddAlbumModal);

