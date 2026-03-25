"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { generateCertificate } from "@/components/generateCertificate";

export default function CertificatePage() {
  const params = useParams();
  const swimmerId = params.id as string;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [swimmer, setSwimmer] = useState<any>(null);

  useEffect(() => {
    async function loadData() {
      const stored = localStorage.getItem("user");
      if (!stored) return;

      const { email } = JSON.parse(stored);

      const res = await fetch(
        `/api/account/swimmers/${swimmerId}?email=${encodeURIComponent(email)}`,
      );

      const data = await res.json();
      //
      if (data?.swimmer) {
        setSwimmer(data.swimmer);

        const url = generateCertificate({
          name: data.swimmer.name,
          // Need to get Swim Club
          university: data.swimmer.organization,
          skill: data.swimmer.level,
          date: new Date().toLocaleDateString(),
        });

        setPreviewUrl(url);
      }
    }

    loadData();
  }, [swimmerId]);

  const handleDownload = () => {
    if (!previewUrl || !swimmer) return;

    const link = document.createElement("a");
    link.href = previewUrl;
    link.download = `${swimmer.name}-certificate.pdf`;
    link.click();
  };

  if (!previewUrl) {
    return <div className="p-6">Loading certificate...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Certificate Preview</h1>

      <iframe
        src={previewUrl}
        width="100%"
        height="600px"
        className="border rounded-lg"
      />

      <button
        onClick={handleDownload}
        className="mt-4 bg-blue-600 text-white px-4 py-2 rounded"
      >
        Download PDF
      </button>
    </div>
  );
}
