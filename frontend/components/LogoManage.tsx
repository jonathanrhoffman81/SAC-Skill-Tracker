"use client";

import { useState } from "react";
import { authFetch } from "@/lib/clientAuth";

export default function LogoManage({
  organizationLogoUrl,
}: {
  organizationLogoUrl?: string | null;
}) {
  const [fileSelected, setFileSelected] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [logoExists, setLogoExists] = useState(Boolean(organizationLogoUrl));
  const [status, setStatus] = useState<
    { type: "success" | "error"; message: string } | null
  >(null);

  const preview = fileSelected
    ? URL.createObjectURL(fileSelected)
    : organizationLogoUrl || null;

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete the logo?")) return;

    setLoading(true);
    setStatus(null);
    try {
      const res = await authFetch("/api/admin/upload-logo", {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setFileSelected(null);
      setLogoExists(false);
      setStatus({ type: "success", message: "Logo deleted successfully." });
    } catch (err) {
      console.error("Delete failed:", err);
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Failed to delete logo." });
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (file: File) => {
    try {
      setLoading(true);
      setStatus(null);

      const formData = new FormData();
      formData.append("file", file);

      const res = await authFetch("/api/admin/upload-logo", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.publicUrl) {
        setFileSelected(null);
        setLogoExists(true);
        setStatus({ type: "success", message: "Logo uploaded successfully." });
      }
    } catch (err) {
      console.error("Upload failed:", err);
      setStatus({ type: "error", message: err instanceof Error ? err.message : "Failed to upload logo." });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {status && (
        <div
          className={`rounded-lg border px-3 py-2 text-xs sm:text-sm ${
            status.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {status.message}
        </div>
      )}

      {/* Preview */}
      <div className="flex flex-col items-center">
        {preview ? (
          <img
            src={preview}
            alt="Logo preview"
            className="w-32 h-32 object-contain rounded-lg border shadow-sm"
          />
        ) : (
          <div className="w-32 h-32 flex items-center justify-center rounded-lg border border-gray-300 text-gray-400 bg-gray-50">
            No logo
          </div>
        )}
      </div>

      {/* Buttons */}
      <div className="flex flex-wrap gap-3 justify-center">
        {/* Choose File */}
        <label
          htmlFor="logoUpload"
          className={`px-4 py-2 bg-gray-200 text-gray-700 rounded-lg cursor-pointer hover:bg-gray-300 ${
            loading ? "opacity-50 cursor-not-allowed" : ""
          }`}
        >
          Choose File
        </label>

        <input
          type="file"
          accept="image/*"
          id="logoUpload"
          className="hidden"
          disabled={loading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              if (file.size > 2 * 1024 * 1024) {
                setStatus({ type: "error", message: "File must be under 2MB." });
                return;
              }
              setFileSelected(file);
              setStatus({ type: "success", message: `Selected file: ${file.name}` });
            }
          }}
        />

        {/* Upload Button */}
        <button
          type="button"
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
          disabled={loading || !fileSelected}
          onClick={() => fileSelected && handleUpload(fileSelected)}
        >
          {loading && fileSelected ? "Uploading..." : "Upload Logo"}
        </button>

        {/* Delete Button */}
        {logoExists && !fileSelected && (
          <button
            type="button"
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:bg-gray-400"
            disabled={loading}
            onClick={handleDelete}
          >
            {loading ? "Deleting..." : "Delete Logo"}
          </button>
        )}
      </div>
    </div>
  );
}
