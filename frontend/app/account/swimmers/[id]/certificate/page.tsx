"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { generateCertificate } from "@/components/generateCertificate";

export default function CertificatePage() {
  const params = useParams();
  const swimmerId = params.id as string;

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [swimmer, setSwimmer] = useState<any>(null);
  const [skills, setSkills] = useState<any[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);

  // Load swimmer + skills
  useEffect(() => {
    async function loadData() {
      const stored = localStorage.getItem("user");
      if (!stored) return;

      const { email } = JSON.parse(stored);

      const res = await fetch(
        `/api/account/swimmers/${swimmerId}?email=${encodeURIComponent(email)}`,
      );

      const data = await res.json();

      if (data?.swimmer) {
        setSwimmer(data.swimmer);

        // ✅ Only completed skills
        const completedSkills = (data.skills || []).filter(
          (s: any) => s.progress === 4,
        );

        setSkills(completedSkills);

        if (completedSkills.length > 0) {
          setSelectedSkillId(completedSkills[0].id);
        }
      }
    }

    loadData();
  }, [swimmerId]);

  // Generate certificate when skill changes
  useEffect(() => {
    async function generatePreview() {
      if (!swimmer || !selectedSkillId) return;

      const skill = skills.find((s) => s.id === selectedSkillId);
      if (!skill) return;

      const url = await generateCertificate({
        name: swimmer.name,
        university: swimmer.organization,
        skill: skill.name, // ✅ correct skill
        date: skill.dateAcquired, // ✅ correct date
      });

      setPreviewUrl(url);
    }

    generatePreview();
  }, [selectedSkillId, swimmer, skills]);

  const handleDownload = () => {
    if (!previewUrl || !swimmer || !selectedSkillId) return;

    const skill = skills.find((s) => s.id === selectedSkillId);
    if (!skill) return;

    const link = document.createElement("a");
    link.href = previewUrl;
    link.download = `${swimmer.name}-${skill.name}-certificate.pdf`;
    link.click();
  };

  // No certificates available
  if (skills.length === 0) {
    return <div className="p-6">No certificates available yet.</div>;
  }

  // Still loading preview
  if (!previewUrl) {
    return <div className="p-6">Loading certificate...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">Certificate Preview</h1>

      {/* ✅ Skill selector */}
      {skills.length > 1 && (
        <select
          value={selectedSkillId || ""}
          onChange={(e) => setSelectedSkillId(e.target.value)}
          className="mb-4 border px-3 py-2 rounded"
        >
          {skills.map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skill.name} ({skill.dateAcquired})
            </option>
          ))}
        </select>
      )}

      {/* ✅ Preview */}
      <iframe
        src={previewUrl}
        width="100%"
        height="600px"
        className="border rounded-lg"
      />

      {/* ✅ Download */}
      <button
        onClick={handleDownload}
        className="mt-4 bg-blue-600 text-white px-4 py-2 rounded"
      >
        Download PDF
      </button>
    </div>
  );
}
