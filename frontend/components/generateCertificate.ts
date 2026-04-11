import { jsPDF } from "jspdf";

// ─── Helpers (unchanged) ────────────────────────────────────────────────────

function cropImageToFit(img: HTMLImageElement, targetRatio: number): string {
  const imgRatio = img.width / img.height;
  let sx = 0,
    sy = 0,
    sWidth = img.width,
    sHeight = img.height;
  if (imgRatio > targetRatio) {
    sWidth = img.height * targetRatio;
    sx = (img.width - sWidth) / 2;
  } else {
    sHeight = img.width / targetRatio;
    sy = (img.height - sHeight) / 2;
  }
  const canvas = document.createElement("canvas");
  canvas.width = sWidth;
  canvas.height = sHeight;
  canvas
    .getContext("2d")
    ?.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
  return canvas.toDataURL("image/png");
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function imageToBase64(img: HTMLImageElement): string {
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext("2d")?.drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

// ─── Design helpers ─────────────────────────────────────────────────────────

const NAVY = [12, 55, 130] as const; // matches blue wave
const GOLD = [175, 138, 40] as const;
const GRAY = [90, 90, 90] as const;

/**
 * Draws a centred ornamental divider:
 *   ───── ◆ ─────
 */
function goldDivider(doc: jsPDF, y: number, lineW = 55) {
  const cx = 148.5;
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.35);
  doc.line(cx - lineW - 3, y, cx - 3, y);
  doc.line(cx + 3, y, cx + lineW + 3, y);
  // diamond
  doc.setFillColor(...GOLD);
  const d = 1.1;
  doc.lines(
    [
      [d, d],
      [d, -d],
      [-d, -d],
      [-d, d],
    ],
    cx - d,
    y,
    [1, 1],
    "F",
    true,
  );
}

/**
 * Draws a thin double-rule box inset from the page edges.
 * Outer rule navy, inner rule gold — mirrors the wave palette.
 */
function decorativeBorder(doc: jsPDF, pw: number, ph: number) {
  const m = 12,
    gap = 2.5;

  doc.setLineWidth(0.9);
  doc.setDrawColor(...NAVY);
  doc.rect(m, m, pw - m * 2, ph - m * 2);

  doc.setLineWidth(0.35);
  doc.setDrawColor(...GOLD);
  doc.rect(m + gap, m + gap, pw - (m + gap) * 2, ph - (m + gap) * 2);
}

// ─── Main export ─────────────────────────────────────────────────────────────

export async function generateCertificate(data: {
  name: string;
  university: string;
  skill: string;
  date: string;
  logoUrl: string | null;
}) {
  const doc = new jsPDF("landscape");
  const { name, university, skill, date, logoUrl } = data;
  const PW = 297,
    PH = 210;

  // 1 · Background (your existing wave image)
  const bgImg = await loadImage("/certificate-bg.png");
  const bgBase64 = imageToBase64(bgImg);
  doc.addImage(bgBase64, "PNG", 0, 0, PW, PH);

  // 2 · Inner decorative border
  decorativeBorder(doc, PW, PH);

  // 3 · Logo — centred, sitting in the top wave band
  if (logoUrl) {
    try {
      const logoImg = await loadImage(logoUrl);
      const bw = 28,
        bh = 28;
      const logoBase64 = cropImageToFit(logoImg, bw / bh);
      // White halo so logo reads on any wave colour
      doc.setFillColor(255, 255, 255);
      doc.circle(PW / 2, 32, 16.5, "F");
      doc.addImage(logoBase64, "PNG", (PW - bw) / 2, 18, bw, bh);
    } catch (err) {
      console.error("Logo load failed", err);
    }
  }

  // 4 · University name  (sits just below the top wave, ~y 54)
  const uniText = university.toUpperCase();
  const charSpace = 1.5;
  doc.setFont("Times", "Bold");
  doc.setFontSize(15);
  doc.setTextColor(...NAVY);

  // charSpace shifts the rendered width but isn't included in getTextWidth(),
  // so we compensate: each gap between N characters adds charSpace once.
  const uniW = doc.getTextWidth(uniText) + charSpace * (uniText.length - 1);
  doc.text(uniText, (PW - uniW) / 2, 54, { charSpace });

  goldDivider(doc, 60, 50);

  // 5 · Certificate title
  doc.setFont("Times", "Bold");
  doc.setFontSize(30);
  doc.setTextColor(...NAVY);
  doc.text("Certificate of Achievement", PW / 2, 76, { align: "center" });

  goldDivider(doc, 82, 65);

  // 6 · "This certifies that"
  doc.setFont("Times", "Italic");
  doc.setFontSize(13);
  doc.setTextColor(...GRAY);
  doc.text("This certifies that", PW / 2, 95, { align: "center" });

  // 7 · Recipient name — large, gold
  doc.setFont("Helvetica", "Bold");
  doc.setFontSize(30);
  doc.setTextColor(...GOLD);
  doc.text(name, PW / 2, 111, { align: "center" });

  // Underline that auto-sizes to the name
  const nameW = doc.getTextWidth(name);
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  doc.line((PW - nameW) / 2, 114, (PW + nameW) / 2, 114);

  // 8 · Body copy
  doc.setFont("Times", "Normal");
  doc.setFontSize(13);
  doc.setTextColor(...GRAY);
  doc.text("has successfully demonstrated mastery of", PW / 2, 125, {
    align: "center",
  });

  // 9 · Skill — navy, slightly larger
  doc.setFont("Times", "BoldItalic");
  doc.setFontSize(19);
  doc.setTextColor(...NAVY);
  doc.text(skill, PW / 2, 136, { align: "center" });

  goldDivider(doc, 142, 50);

  // 10 · Date
  doc.setFont("Times", "Normal");
  doc.setFontSize(12);
  doc.setTextColor(...GRAY);
  doc.text(`Issued: ${date}`, PW / 2, 153, { align: "center" });

  // 11 · Signature lines (inside the content area, above bottom wave ~y 175)
  const sigY = 167;
  doc.setLineWidth(0.4);
  doc.setDrawColor(...NAVY);

  const sig = (cx: number, label: string) => {
    doc.line(cx - 32, sigY, cx + 32, sigY);
    doc.setFont("Times", "Normal");
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text(label, cx, sigY + 5, { align: "center" });
  };

  // Output
  const blob = doc.output("blob");
  return URL.createObjectURL(blob);
}
