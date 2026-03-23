import { useState } from "react";
import Papa from "papaparse";

export default function ImportRoster({
  organizationId,
}: {
  organizationId?: string;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [importedMemberCount, setImportedMemberCount] = useState<number>(0);
  const [importedInstructorCount, setImportedInstructorCount] =
    useState<number>(0);
  const [importedAdminCount, setImportedAdminCount] = useState<number>(0);
  const [errors, setErrors] = useState<string[]>([]);

  const allowedBillingGroups = [
    "Group 1",
    "Group 2",
    "High School - Non Competitive",
    "High School",
    "Coaches",
    "Board Members",
    "Annual",
  ];

  const requiredHeaders = [
    "Memb. First Name",
    "Memb. Last Name",
    "Acct. First Name",
    "Acct. Last Name",
    "Email",
    "Gender",
    "Birthday",
    "Billing Group",
  ];

  const handleFile = (file: File) => {
    if (file.type !== "text/csv") {
      alert("Only CSV files allowed");
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields;

        const missingHeaders = requiredHeaders.filter(
          (h) => !headers?.includes(h),
        );

        if (missingHeaders.length > 0) {
          setErrors([`Missing columns: ${missingHeaders.join(", ")}`]);
          return;
        }

        const rows = results.data.map((row: any) => ({
          first_name: row["Memb. First Name"]?.trim(),
          last_name: row["Memb. Last Name"]?.trim(),
          acc_first_name: row["Acct. First Name"]?.trim(),
          acc_last_name: row["Acct. Last Name"]?.trim(),
          email: row["Email"]?.toLowerCase().trim(),
          gender: row["Gender"],
          birthday: row["Birthday"],
          billing_group: row["Billing Group"]?.trim(),
        }));

        const validationErrors: string[] = [];

        rows.forEach((row, index) => {
          const rowNumber = index + 2;
          if (!row.first_name)
            validationErrors.push(
              `Row ${rowNumber}: Missing member first name`,
            );
          if (!row.last_name)
            validationErrors.push(`Row ${rowNumber}: Missing member last name`);
          if (!row.acc_first_name)
            validationErrors.push(
              `Row ${rowNumber}: Missing account first name`,
            );
          if (!row.acc_last_name)
            validationErrors.push(
              `Row ${rowNumber}: Missing account last name`,
            );
          if (!row.email)
            validationErrors.push(`Row ${rowNumber}: Missing email`);

          if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email))
            validationErrors.push(`Row ${rowNumber}: Invalid email format`);

          const allowedGenders = ["Male", "Female", "M", "F"];
          if (row.gender && !allowedGenders.includes(row.gender))
            validationErrors.push(`Row ${rowNumber}: Invalid gender value`);

          if (row.birthday && isNaN(Date.parse(row.birthday)))
            validationErrors.push(`Row ${rowNumber}: Invalid birthday format`);
          if (!row.billing_group)
            validationErrors.push(`Row ${rowNumber}: Missing Billing Group`);
          else if (!allowedBillingGroups.includes(row.billing_group))
            validationErrors.push(
              `Row ${rowNumber}: Invalid Billing Group (${row.billing_group})`,
            );
        });

        if (validationErrors.length > 0) {
          setErrors(validationErrors.slice(0, 10)); // show first 10
          return;
        }

        setErrors([]);
        setSelectedFile(file);
        setImportedMemberCount(0);
        setImportedAdminCount(0);
        setImportedInstructorCount(0);
      },
    });
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile || !organizationId) return;

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("organization_id", organizationId);

      const res = await fetch("/api/admin/import-roster", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setImportedMemberCount(data.importedMembers);
        setImportedAdminCount(data.importedAdmins);
        setImportedInstructorCount(data.importedInstructors);

        setSelectedFile(null); // reset file after success
      } else {
        setErrors([data.error || "Import failed"]);
      }
    } catch (err: any) {
      setErrors([err.message || "Unexpected error"]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-lg sm:rounded-xl p-6 sm:p-10 flex flex-col items-center text-center mb-4 sm:mb-6 transition ${
          isDragging ? "border-black bg-gray-50" : "border-gray-200"
        }`}
      >
        <p className="text-sm sm:text-base font-semibold text-gray-900 mb-1">
          Import Roster Data
        </p>

        <p className="text-xs sm:text-sm text-gray-500 mb-4 sm:mb-5">
          Import swimmer roster, levels, and class assignments from SportsEngine
        </p>

        <input
          type="file"
          accept=".csv"
          className="hidden"
          id="csvUpload"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />

        <div className="flex gap-3">
          <label
            htmlFor="csvUpload"
            className={`cursor-pointer flex items-center gap-2 border text-gray-700 text-sm font-medium px-4 py-2 rounded-lg transition
      ${!isLoading ? "border-gray-300 hover:bg-gray-50" : "border-gray-200 bg-gray-200 text-gray-400 cursor-not-allowed pointer-events-none"}
    `}
          >
            Upload CSV
          </label>

          <button
            onClick={handleUpload}
            disabled={!selectedFile || isLoading}
            className={`text-sm font-medium px-4 py-2 rounded-lg transition ${
              selectedFile && !isLoading
                ? "bg-black text-white hover:opacity-90"
                : "bg-gray-200 text-gray-400 cursor-not-allowed"
            }`}
          >
            {isLoading ? "Importing..." : "Import"}
          </button>
        </div>

        {selectedFile && (
          <p className="mt-3 text-xs text-gray-500">
            Selected: {selectedFile.name}
          </p>
        )}

        {(importedMemberCount > 0 ||
          importedInstructorCount > 0 ||
          importedAdminCount > 0) && (
          <div>
            <p className="mt-2 text-sm text-green-600">
              Successfully imported {importedMemberCount} swimmers.
            </p>
            <p className="mt-2 text-sm text-green-600">
              Successfully imported {importedInstructorCount} instructors.
            </p>
            <p className="mt-2 text-sm text-green-600">
              Successfully imported {importedAdminCount} admins.
            </p>
          </div>
        )}

        {errors.length > 0 && (
          <div className="mt-2 text-sm text-red-600 space-y-1">
            {errors.map((err, i) => (
              <p key={i}>{err}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
