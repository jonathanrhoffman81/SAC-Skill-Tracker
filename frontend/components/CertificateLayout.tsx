"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import { generateCertificate } from "@/components/generateCertificate";
import { createAuthenticatedHeaders } from "@/lib/clientAuth";

/* ─── types ─────────────────────────────────────────────────────────────── */

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
  swimmer?: { name: string; organization: string };
  sessions?: SessionPayload[];
}
interface LogoResponse {
  publicUrl?: string | null;
}
interface Skill {
  id: string;
  name: string;
  dateAcquired: string;
}

/* ─── helpers ────────────────────────────────────────────────────────────── */

function sealColors(name: string) {
  const palettes = [
    {
      bg: "#FDF6E3",
      ring: "#C8A84B",
      star: "#E6C35A",
      glow: "#FFF3C4",
      text: "#7A5C1E",
    },
    {
      bg: "#EEF4FF",
      ring: "#4A7FC1",
      star: "#6B9FD4",
      glow: "#DDEAFF",
      text: "#1E3A5F",
    },
    {
      bg: "#F0FAF4",
      ring: "#3A8C5C",
      star: "#5AAD7A",
      glow: "#C8EDD8",
      text: "#1B4D30",
    },
    {
      bg: "#FDF0F8",
      ring: "#A84B8C",
      star: "#C96AAD",
      glow: "#F5C9EC",
      text: "#5C1E47",
    },
    {
      bg: "#FFF4EE",
      ring: "#C46B2D",
      star: "#E08A4A",
      glow: "#FFD9BC",
      text: "#7A3210",
    },
    {
      bg: "#F0F8FF",
      ring: "#2D7A8C",
      star: "#4A9FB0",
      glow: "#B8E8F0",
      text: "#104552",
    },
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++)
    hash = (hash * 31 + name.charCodeAt(i)) & 0xffffffff;
  return palettes[Math.abs(hash) % palettes.length];
}

function starPath(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  points: number,
) {
  const step = Math.PI / points;
  let d = "";
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = i * step - Math.PI / 2;
    d +=
      (i === 0 ? "M" : "L") +
      `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }
  return d + "Z";
}

/* ─── SealBadge ──────────────────────────────────────────────────────────── */

function SealBadge({ skill, onClick }: { skill: Skill; onClick: () => void }) {
  const c = sealColors(skill.name);
  const [hovered, setHovered] = useState(false);

  const shield =
    "M48 6 C48 6 14 10 10 14 L10 46 C10 66 28 82 48 90 C68 82 86 66 86 46 L86 14 C82 10 48 6 48 6 Z";

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: "var(--color-background-primary)",
        border: "1.5px solid var(--color-border-tertiary)",
        borderRadius: "16px",
        padding: "20px 12px 16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "10px",
        cursor: "pointer",
        transform: hovered ? "translateY(-2px)" : "none",
        transition: "transform 0.2s ease",
        textAlign: "center",
        width: "100%",
      }}
    >
      <svg
        width="72"
        height="84"
        viewBox="0 0 96 112"
        style={{
          filter: hovered
            ? `drop-shadow(0 4px 10px ${c.ring}66)`
            : `drop-shadow(0 2px 4px ${c.ring}33)`,
          transition: "filter 0.2s",
        }}
      >
        <path
          d={shield}
          fill={c.ring}
          transform="translate(0, 3)"
          opacity="0.18"
        />
        <path d={shield} fill={c.bg} stroke={c.ring} strokeWidth="2.5" />
        <path
          d="M48 13 C48 13 19 17 16 20 L16 46 C16 63 31 77 48 84 C65 77 80 63 80 46 L80 20 C77 17 48 13 48 13 Z"
          fill="none"
          stroke={c.ring}
          strokeWidth="1.2"
          strokeDasharray="3 2"
          opacity="0.45"
        />
        <circle cx="48" cy="46" r="22" fill={c.glow} opacity="0.35" />
        <path d={starPath(48, 46, 17, 7, 5)} fill={c.star} opacity="0.9" />
        <rect
          x="22"
          y="7"
          width="52"
          height="9"
          rx="4.5"
          fill={c.ring}
          opacity="0.85"
        />
        <circle cx="34" cy="11.5" r="1.8" fill="white" opacity="0.6" />
        <circle cx="48" cy="11.5" r="1.8" fill="white" opacity="0.6" />
        <circle cx="62" cy="11.5" r="1.8" fill="white" opacity="0.6" />
      </svg>

      <p
        style={{
          margin: 0,
          fontSize: "13px",
          fontWeight: 600,
          color: "var(--color-text-primary)",
          lineHeight: 1.3,
        }}
      >
        {skill.name}
      </p>
    </button>
  );
}

/* ─── Main Page ──────────────────────────────────────────────────────────── */

interface CertificatePageProps {
  compact?: boolean;
  swimmerName?: string;
  organization?: string;
  initialSkills?: Skill[];
}

export default function CertificatePage({
  compact = true,
  swimmerName,
  organization,
  initialSkills,
}: CertificatePageProps) {
  const params = useParams();
  const swimmerId = params.id as string;

  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [swimmer, setSwimmer] = useState<{
    name: string;
    organization: string;
  } | null>(
    swimmerName && organization ? { name: swimmerName, organization } : null,
  );
  const [skills, setSkills] = useState<Skill[]>(initialSkills ?? []);
  const [isLoading, setIsLoading] = useState(!swimmerName);

  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [modalUrl, setModalUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const urlCache = useRef<Record<string, string>>({});

  /* load swimmer — skipped when data is passed via props */
  useEffect(() => {
    if (swimmerName) return;
    async function loadData() {
      try {
        const headers = await createAuthenticatedHeaders();
        const res = await fetch(`/api/account/swimmers/${swimmerId}`, {
          headers,
        });
        const data = (await res.json()) as SwimmerPayload;
        if (!data?.swimmer) return;
        setSwimmer(data.swimmer);
        const map = new Map<string, Skill>();
        (data.sessions ?? []).forEach((session) => {
          (session.skills ?? []).forEach((skill) => {
            const done = skill.progress === 4 || Boolean(skill.dateAcquired);
            if (!done) return;
            const ex = map.get(skill.id);
            if (
              !ex ||
              (!ex.dateAcquired && skill.dateAcquired) ||
              (ex.dateAcquired &&
                skill.dateAcquired &&
                new Date(skill.dateAcquired) < new Date(ex.dateAcquired))
            ) {
              map.set(skill.id, {
                id: skill.id,
                name: skill.name,
                dateAcquired: skill.dateAcquired || "",
              });
            }
          });
        });
        setSkills(
          Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch (err) {
        console.error("Error loading swimmer:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, [swimmerId, swimmerName]);

  /* load logo — always fetched independently */
  useEffect(() => {
    async function fetchLogo() {
      try {
        const headers = await createAuthenticatedHeaders();
        const res = await fetch("/api/public/get-logo", { headers });
        const data = (await res.json()) as LogoResponse;
        if (data.publicUrl) setLogoUrl(data.publicUrl);
      } catch (err) {
        console.error("Failed to fetch logo", err);
      }
    }
    fetchLogo();
  }, []);

  /* open modal */
  const openModal = useCallback(
    async (skill: Skill) => {
      setSelectedSkill(skill);
      setModalUrl(null);
      if (!swimmer) return;

      const cacheKey = `${skill.id}:${logoUrl ?? "no-logo"}`;
      if (urlCache.current[cacheKey]) {
        setModalUrl(urlCache.current[cacheKey]);
        return;
      }

      setIsGenerating(true);
      const url = await generateCertificate({
        name: swimmer.name,
        university: swimmer.organization,
        skill: skill.name,
        date: skill.dateAcquired,
        logoUrl,
      });
      urlCache.current[cacheKey] = url;
      setModalUrl(url);
      setIsGenerating(false);
    },
    [swimmer, logoUrl],
  );

  const closeModal = () => {
    setSelectedSkill(null);
    setModalUrl(null);
    setIsGenerating(false);
  };

  const handleDownload = async () => {
    if (!modalUrl || !swimmer || !selectedSkill) return;
    setIsDownloading(true);
    const link = document.createElement("a");
    link.href = modalUrl;
    link.download = `${swimmer.name}-${selectedSkill.name}-certificate.pdf`;
    link.click();
    setIsDownloading(false);
  };

  if (isLoading) return <p>Loading…</p>;
  if (skills.length === 0) return null;

  const c = selectedSkill ? sealColors(selectedSkill.name) : null;

  return (
    <div style={{ padding: compact ? 0 : "16px" }}>
      {/* Badge grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
          gap: "14px",
        }}
      >
        {skills.map((skill) => (
          <SealBadge
            key={skill.id}
            skill={skill}
            onClick={() => openModal(skill)}
          />
        ))}
      </div>

      {/* Modal */}
      {selectedSkill && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.65)",
            backdropFilter: "blur(6px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px",
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "720px",
              borderRadius: "20px",
              overflow: "hidden",
              boxShadow: "0 32px 100px rgba(0,0,0,0.45)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Top bar */}
            <div
              style={{
                background: `linear-gradient(135deg, ${c!.ring}, ${c!.star})`,
                padding: "18px 24px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div
                style={{ display: "flex", alignItems: "center", gap: "10px" }}
              >
                <svg width="32" height="32" viewBox="0 0 96 96">
                  <circle
                    cx="48"
                    cy="48"
                    r="44"
                    fill="rgba(255,255,255,0.15)"
                  />
                  <circle
                    cx="48"
                    cy="48"
                    r="36"
                    fill="rgba(255,255,255,0.2)"
                    stroke="white"
                    strokeWidth="2"
                  />
                  <path
                    d={starPath(48, 48, 15, 6, 5)}
                    fill="white"
                    opacity="0.9"
                  />
                </svg>
                <div>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "11px",
                      color: "rgba(255,255,255,0.7)",
                      textTransform: "uppercase",
                      letterSpacing: "1px",
                    }}
                  >
                    Certificate of Achievement
                  </p>
                  <p
                    style={{
                      margin: 0,
                      fontSize: "14px",
                      fontWeight: 700,
                      color: "white",
                    }}
                  >
                    {selectedSkill.name}
                  </p>
                </div>
              </div>
              <button
                onClick={closeModal}
                style={{
                  background: "rgba(255,255,255,0.2)",
                  border: "none",
                  borderRadius: "50%",
                  width: 34,
                  height: 34,
                  cursor: "pointer",
                  fontSize: "16px",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ✕
              </button>
            </div>

            {/* Certificate area */}
            <div
              style={{
                background: "#f8f7f4",
                padding: "20px",
                position: "relative",
                minHeight: "460px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: "100%",
                  borderRadius: "8px",
                  overflow: "hidden",
                  boxShadow:
                    "0 2px 16px rgba(0,0,0,0.12), inset 0 0 0 1px rgba(0,0,0,0.06)",
                  border: `2px solid ${c!.ring}33`,
                }}
              >
                {isGenerating || !modalUrl ? (
                  <div
                    style={{
                      height: "440px",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 14,
                      background: "white",
                    }}
                  >
                    <svg
                      width="48"
                      height="48"
                      viewBox="0 0 96 96"
                      style={{ animation: "spin 2s linear infinite" }}
                    >
                      <path
                        d={starPath(48, 48, 47, 40, 20)}
                        fill={c!.ring}
                        opacity="0.2"
                      />
                      <circle
                        cx="48"
                        cy="48"
                        r="36"
                        fill={c!.bg}
                        stroke={c!.ring}
                        strokeWidth="2.5"
                      />
                      <path
                        d={starPath(48, 48, 15, 6, 5)}
                        fill={c!.star}
                        opacity="0.8"
                      />
                    </svg>
                    <p style={{ margin: 0, fontSize: "13px", color: "#888" }}>
                      Generating certificate…
                    </p>
                    <style>{`@keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }`}</style>
                  </div>
                ) : (
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "1.414 / 1",
                      maxHeight: "80vh",
                    }}
                  >
                    <iframe
                      src={`${modalUrl}#toolbar=0&navpanes=0&scrollbar=0&zoom=page-fit`}
                      style={{
                        width: "100%",
                        height: "100%",
                        border: "none",
                        display: "block",
                        background: "white",
                      }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                background: "white",
                padding: "16px 24px",
                display: "flex",
                justifyContent: "flex-end",
                gap: "10px",
                borderTop: `3px solid ${c!.ring}22`,
              }}
            >
              <button
                onClick={handleDownload}
                disabled={!modalUrl || isDownloading}
                style={{
                  padding: "9px 22px",
                  borderRadius: "10px",
                  border: "none",
                  background: !modalUrl
                    ? "#ccc"
                    : `linear-gradient(135deg, ${c!.ring}, ${c!.star})`,
                  color: "white",
                  cursor: !modalUrl ? "not-allowed" : "pointer",
                  fontSize: "13px",
                  fontWeight: 700,
                  boxShadow: modalUrl ? `0 4px 14px ${c!.ring}55` : "none",
                  display: "flex",
                  alignItems: "center",
                  gap: "7px",
                  transition: "opacity 0.15s",
                  opacity: isDownloading ? 0.7 : 1,
                }}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 3v13M5 16l7 7 7-7" />
                </svg>
                {isDownloading ? "Downloading…" : "Download"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
