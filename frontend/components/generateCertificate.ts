import { jsPDF } from "jspdf";

function loadImageAsBase64(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;

      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0);

      resolve(canvas.toDataURL("image/png"));
    };

    img.onerror = reject;
    img.src = src;
  });
}

export async function generateCertificate(data: any) {
  const doc = new jsPDF("landscape");

  const { name, university, skill, date } = data;
  // skill = skill.name
  // date = skill.dateAcquired

  // Background
  const bg = await loadImageAsBase64("/certificate-bg.png");
  doc.addImage(bg, "PNG", 0, 0, 297, 210);

  // --- Typography styling ---
  doc.setTextColor(20, 20, 20);

  // Organization
  doc.setFont("Times", "Bold");
  doc.setFontSize(20);
  doc.text(university, 148, 45, { align: "center" });

  // Title
  doc.setFontSize(34);
  doc.text("Certificate of Achievement", 148, 70, { align: "center" });

  // Subtitle
  doc.setFont("Times", "Italic");
  doc.setFontSize(14);
  doc.text("This certifies that", 148, 90, { align: "center" });

  // Name
  doc.setFont("Helvetica", "Bold");
  doc.setFontSize(30);
  doc.text(name, 148, 110, { align: "center" });

  doc.setFont("Times", "Normal");
  doc.setFontSize(14);
  doc.text(`has successfully mastered`, 148, 125, { align: "center" });

  doc.setFont("Times", "Bold");
  doc.setFontSize(20);
  doc.text(skill, 148, 135, { align: "center" });

  doc.setFont("Times", "Normal");
  doc.setFontSize(14);
  doc.text(`Date Acquired: ${date}`, 148, 150, { align: "center" });

  const blob = doc.output("blob");
  return URL.createObjectURL(blob);
}
