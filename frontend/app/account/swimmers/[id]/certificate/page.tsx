"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { generateCertificate } from "@/components/generateCertificate";
import { createAuthenticatedHeaders } from "@/lib/clientAuth";

interface SessionSkill {
  id: string;
  name: string;
  mastered: boolean;
  progress: number;
  dateAcquired?: string;
}

interface SessionPayload {
  id: string;
  name: string;
  skills: SessionSkill[];
}

interface SwimmerPayload {
  swimmer?: {
    name: string;
    organization: string;
  };
  sessions?: SessionPayload[];
}

interface LogoResponse {
  publicUrl?: string | null;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function CertificatePage() {
  const router = useRouter();
  const params = useParams();
  const swimmerId = params.id as string;

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [swimmer, setSwimmer] = useState<any>(null);
  const [skills, setSkills] = useState<any[]>([]);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const generatedForSkillRef = useRef<string | null>(null);

  // Load swimmer + skills
  useEffect(() => {
    async function loadData() {
      try {
        const headers = await createAuthenticatedHeaders();

        const res = await fetch(`/api/account/swimmers/${swimmerId}`, {
          headers,
        });

        const data = (await res.json()) as SwimmerPayload;

        if (data?.swimmer) {
          setSwimmer(data.swimmer);
          const completedSkillMap = new Map<
            string,
            { id: string; name: string; dateAcquired?: string }
          >();

          (data.sessions ?? []).forEach((session: SessionPayload) => {
            (session.skills ?? []).forEach((skill: SessionSkill) => {
              const isCompleted = skill.progress === 4 || Boolean(skill.dateAcquired);
              if (!isCompleted) return;

              const existing = completedSkillMap.get(skill.id);
              if (!existing) {
                completedSkillMap.set(skill.id, {
                  id: skill.id,
                  name: skill.name,
                  dateAcquired: skill.dateAcquired,
                });
                return;
              }

              if (
                !existing.dateAcquired ||
                (skill.dateAcquired &&
                  new Date(skill.dateAcquired).getTime() <
                    new Date(existing.dateAcquired).getTime())
              ) {
                completedSkillMap.set(skill.id, {
                  id: skill.id,
                  name: skill.name,
                  dateAcquired: skill.dateAcquired,
                });
              }
            });
          });

          const completedSkills = Array.from(completedSkillMap.values()).sort(
            (a, b) => a.name.localeCompare(b.name),
          );

          setSkills(completedSkills);

          if (completedSkills.length > 0) {
            setSelectedSkillId(completedSkills[0].id);
          }
        }
      } catch (err) {
        console.error("Error loading swimmer:", err);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [swimmerId]);

  useEffect(() => {
    async function fetchLogo() {
      try {
        const headers = await createAuthenticatedHeaders();

        const res = await fetch("/api/admin/get-logo", {
          headers,
        });

        const data = (await res.json()) as LogoResponse;

        if (data.publicUrl) {
          setLogoUrl(data.publicUrl);
        }
      } catch (err) {
        console.error("Failed to fetch logo", err);
      }
    }

    fetchLogo();
  }, []);

  // Generate certificate
  useEffect(() => {
    async function generatePreview() {
      if (!swimmer || !selectedSkillId) return;

      const generationKey = `${selectedSkillId}:${logoUrl ?? "no-logo"}`;
      if (generatedForSkillRef.current === generationKey) return;
      generatedForSkillRef.current = generationKey;

      setPreviewUrl(null);

      const skill = skills.find((s) => s.id === selectedSkillId);
      if (!skill) return;

      const url = await generateCertificate({
        name: swimmer.name,
        university: swimmer.organization,
        skill: skill.name,
        date: skill.dateAcquired,
        logoUrl,
      });

      setPreviewUrl(url);
    }

    generatePreview();
  }, [selectedSkillId, swimmer, skills, logoUrl]);

  const handleDownload = () => {
    if (!previewUrl || !swimmer || !selectedSkillId) return;

    const skill = skills.find((s) => s.id === selectedSkillId);
    if (!skill) return;

    const link = document.createElement("a");
    link.href = previewUrl;
    link.download = `${swimmer.name}-${skill.name}-certificate.pdf`;
    link.click();
  };

  if (isLoading) {
    return <div className="p-6">Loading...</div>;
  }

  if (skills.length === 0) {
    return <div className="p-6">No certificates available yet.</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <div className="flex items-center gap-4">
            {/* Back button */}
            <button
              onClick={() => router.back()}
              className="-ml-2 rounded-lg p-2 text-gray-500 hover:bg-gray-100"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>

            {/* Avatar + name */}
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-lg font-semibold text-gray-700">
                {getInitials(swimmer?.name ?? "Unknown")}
              </div>

              <div>
                <h1 className="text-xl font-semibold text-gray-900">
                  {swimmer?.name}
                </h1>
                <p className="text-xs text-gray-500">Parent View</p>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="text-xl font-semibold mb-4">Certificate Preview</h1>

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

        <div className="relative">
          {!previewUrl && (
            <div className="absolute inset-0 flex items-center justify-center bg-white border rounded-lg">
              Generating certificate...
            </div>
          )}

          {previewUrl && (
            <iframe
              src={previewUrl}
              width="100%"
              height="600px"
              className="border rounded-lg"
            />
          )}
        </div>

        <button
          onClick={handleDownload}
          className="mt-4 bg-blue-600 text-white px-4 py-2 rounded"
        >
          Download PDF
        </button>
      </main>
    </div>
  );
}
