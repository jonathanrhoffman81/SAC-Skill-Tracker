import { useEffect, useState } from "react";

export default function LogoManage({
  organizationId,
}: {
  organizationId: string;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [fileSelected, setFileSelected] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [logoExists, setLogoExists] = useState(false);

  // Load existing logo
  useEffect(() => {
    const fetchLogo = async () => {
      try {
        const res = await fetch("/api/admin/get-logo");
        const data = await res.json();

        if (data.publicUrl) {
          setPreview(data.publicUrl);
          setLogoExists(true);
        } else {
          setPreview(null);
          setLogoExists(false);
        }
      } catch (err) {
        console.error("Failed to fetch logo", err);
      }
    };

    fetchLogo();
  }, []);

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete the logo?")) return;

    setLoading(true);
    try {
      const res = await fetch("/api/admin/upload-logo", {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      setPreview(null);
      setFileSelected(null);
      setLogoExists(false);
    } catch (err) {
      console.error("Delete failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (file: File) => {
    try {
      setLoading(true);

      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/admin/upload-logo", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      if (data.publicUrl) {
        setPreview(data.publicUrl);
        setFileSelected(null);
        setLogoExists(true);
      }
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Preview */}
      <div className="flex flex-col items-center">
        {preview ? (
          <img
            src={preview}
            alt="Logo preview"
            className="w-32 h-32 object-cover rounded-lg border shadow-sm"
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
                alert("File must be under 2MB");
                return;
              }
              setFileSelected(file);
              setPreview(URL.createObjectURL(file));
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
