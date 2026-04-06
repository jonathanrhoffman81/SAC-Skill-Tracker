import { jsPDF } from "jspdf";

// Helper: crop image to fit box (like CSS object-fit: cover)
function cropImageToFit(img: HTMLImageElement, targetRatio: number): string {
  const imgRatio = img.width / img.height;

  let sx = 0,
    sy = 0,
    sWidth = img.width,
    sHeight = img.height;

  if (imgRatio > targetRatio) {
    // wider → crop sides
    sWidth = img.height * targetRatio;
    sx = (img.width - sWidth) / 2;
  } else {
    // taller → crop top/bottom
    sHeight = img.width / targetRatio;
    sy = (img.height - sHeight) / 2;
  }

  const canvas = document.createElement("canvas");
  canvas.width = sWidth;
  canvas.height = sHeight;

  const ctx = canvas.getContext("2d");
  ctx?.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

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

  const ctx = canvas.getContext("2d");
  ctx?.drawImage(img, 0, 0);

  return canvas.toDataURL("image/png");
}

export async function generateCertificate(data: any) {
  const doc = new jsPDF("landscape");

  const { name, university, skill, date, logoUrl } = data;

  const Y_OFFSET = 10;

  // Background
  const bgImg = await loadImage("/certificate-bg.png");
  const bgBase64 = imageToBase64(bgImg);
  doc.addImage(bgBase64, "PNG", 0, 0, 297, 210);

  if (logoUrl) {
    try {
      const logoImg = await loadImage(logoUrl);

      const boxWidth = 30;
      const boxHeight = 30;

      const targetRatio = boxWidth / boxHeight;

      const logoBase64 = cropImageToFit(logoImg, targetRatio);

      const x = (297 - boxWidth) / 2;
      const y = 20 + Y_OFFSET;

      // 🔥 jsPDF scales it cleanly here
      doc.addImage(logoBase64, "PNG", x, y, boxWidth, boxHeight);
    } catch (err) {
      console.error("Logo load failed", err);
    }
  }

  // --- Typography ---
  doc.setTextColor(20, 20, 20);

  // Organization
  doc.setFont("Times", "Bold");
  doc.setFontSize(20);
  doc.text(university, 148, 60 + Y_OFFSET, { align: "center" });

  // Title
  doc.setFontSize(34);
  doc.text("Certificate of Achievement", 148, 80 + Y_OFFSET, {
    align: "center",
  });

  // Subtitle
  doc.setFont("Times", "Italic");
  doc.setFontSize(14);
  doc.text("This certifies that", 148, 100 + Y_OFFSET, {
    align: "center",
  });

  // Name
  doc.setFont("Helvetica", "Bold");
  doc.setFontSize(30);
  doc.text(name, 148, 120 + Y_OFFSET, { align: "center" });

  // Body
  doc.setFont("Times", "Normal");
  doc.setFontSize(14);
  doc.text(`has successfully mastered`, 148, 135 + Y_OFFSET, {
    align: "center",
  });

  // Skill
  doc.setFont("Times", "Bold");
  doc.setFontSize(20);
  doc.text(skill, 148, 145 + Y_OFFSET, { align: "center" });

  // Date
  doc.setFont("Times", "Normal");
  doc.setFontSize(14);
  doc.text(`Date Acquired: ${date}`, 148, 160 + Y_OFFSET, {
    align: "center",
  });

  const blob = doc.output("blob");
  return URL.createObjectURL(blob);
}
