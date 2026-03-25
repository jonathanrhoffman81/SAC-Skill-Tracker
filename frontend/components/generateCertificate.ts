import { jsPDF } from "jspdf";

export function generateCertificate(data: any) {
  const doc = new jsPDF("landscape");

  const { name, university, skill, date } = data;

  // Border
  doc.setLineWidth(2);
  doc.rect(10, 10, 277, 190);
  doc.setLineWidth(0.5);
  doc.rect(15, 15, 267, 180);

  // University
  doc.setFont("Times", "Bold");
  doc.setFontSize(22);
  doc.text(university, 148, 35, { align: "center" });

  // Title
  doc.setFontSize(30);
  doc.text("Certificate of Achievement", 148, 55, { align: "center" });

  // Subtitle
  doc.setFont("Times", "Italic");
  doc.setFontSize(16);
  doc.text("This certifies that", 148, 75, { align: "center" });

  // Name
  doc.setFont("Helvetica", "Bold");
  doc.setFontSize(28);
  doc.text(name, 148, 95, { align: "center" });

  // Skill text
  doc.setFont("Times", "Normal");
  doc.setFontSize(16);
  doc.text(`has successfully completed the ${skill} program`, 148, 115, {
    align: "center",
  });

  // Date
  doc.setFontSize(12);
  doc.text(`Date: ${date}`, 40, 180);

  // Signature line
  doc.line(200, 160, 260, 160);
  doc.text("Authorized Signature", 230, 170, { align: "center" });

  // Logo
  //doc.addImage("/logo.png", "PNG", 20, 20, 30, 30);

  const pdfBlob = doc.output("blob");
  return URL.createObjectURL(pdfBlob);
}
