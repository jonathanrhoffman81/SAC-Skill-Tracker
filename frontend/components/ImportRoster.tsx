import { useState } from "react";
import Papa from "papaparse";
import { authFetch } from "@/lib/clientAuth";

type Step = "upload" | "importing" | "done";

interface ImportResult {
  importedMembers: number;
  updatedMembers: number;
  importedInstructors: number;
  updatedInstructors: number;
  importedAdmins: number;
  updatedAdmins: number;
  importedGuardians: number;
  updatedGuardians: number;
}

export default function ImportRoster({
  organizationId,
  onImportComplete,
}: {
  organizationId?: string;
  onImportComplete?: () => void;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

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
      setStatus({ type: "error", message: "Only CSV files are allowed." });
      setErrors(["Only CSV files are allowed."]);
      return;
    }

    setStatus(null);
    setErrors([]);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields;

        const missingHeaders = requiredHeaders.filter(
          (h) => !headers?.includes(h),
        );

        if (missingHeaders.length > 0) {
          setStatus({ type: "error", message: "CSV validation failed." });
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

        // Only validate rows that have at least one field populated
        const dataRows = rows.filter(
          (r) => r.first_name || r.last_name || r.email,
        );
        const validationErrors: string[] = [];

        dataRows.forEach((row, index) => {
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
          setStatus({ type: "error", message: "CSV validation failed." });
          setErrors(validationErrors.slice(0, 10));
          return;
        }

        setStatus({
          type: "success",
          message: `File validated. ${dataRows.length} rows ready to import.`,
        });
        setErrors([]);
        setSelectedFile(file);
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

    setErrors([]);
    setStatus(null);
    setStep("importing");
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("organization_id", organizationId);

      const res = await authFetch("/api/admin/import-roster", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setImportResult({
          importedMembers: data.importedMembers,
          updatedMembers: data.updatedMembers ?? 0,
          importedInstructors: data.importedInstructors,
          updatedInstructors: data.updatedInstructors ?? 0,
          importedAdmins: data.importedAdmins,
          updatedAdmins: data.updatedAdmins ?? 0,
          importedGuardians: data.importedGuardians ?? 0,
          updatedGuardians: data.updatedGuardians ?? 0,
        });
        setStatus({
          type: "success",
          message: "Roster imported successfully.",
        });
        setStep("done");
        onImportComplete?.();
      } else {
        setStatus({ type: "error", message: data.error || "Import failed." });
        setErrors([data.error || "Import failed."]);
        setStep("upload");
      }
    } catch (err: any) {
      setStatus({ type: "error", message: err.message || "Unexpected error." });
      setErrors([err.message || "Unexpected error."]);
      setStep("upload");
    } finally {
      setIsLoading(false);
    }
  };

  const resetState = () => {
    setStep("upload");
    setSelectedFile(null);
    setImportResult(null);
    setErrors([]);
    setStatus(null);
  };

  return (
    <div className="p-4 sm:p-6">
      {status && (
        <div
          className={`mb-4 rounded-lg border px-3 py-2 text-xs sm:text-sm ${
            status.type === "success"
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-800"
          }`}
        >
          {status.message}
        </div>
      )}

      {/* ── Step 1: Upload ─────────────────────────────────────────── */}
      {step === "upload" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-10 flex flex-col items-center text-center transition ${
            isDragging ? "border-black bg-gray-50" : "border-gray-200"
          }`}
        >
          <p className="text-base font-semibold text-gray-900 mb-1">
            Import Roster Data
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Import swimmer roster and class assignments from SportsEngine
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

          <div className="flex flex-col items-center gap-3">
            <label
              htmlFor="csvUpload"
              className={`cursor-pointer border text-gray-700 text-sm font-medium px-5 py-2.5 rounded-lg transition ${
                isLoading
                  ? "border-gray-200 bg-gray-100 text-gray-400 pointer-events-none"
                  : "border-gray-300 hover:bg-gray-50"
              }`}
            >
              Choose file
            </label>

            {selectedFile && (
              <p className="text-xs text-gray-500">
                Selected: {selectedFile.name}
              </p>
            )}
          </div>

          {errors.length > 0 && (
            <div className="mt-4 text-sm text-red-600 space-y-1">
              {errors.map((err, i) => (
                <p key={i}>{err}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Confirm button shown below drop zone when file is valid ── */}
      {step === "upload" && selectedFile && !errors.length && (
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => {
              setSelectedFile(null);
              setStatus(null);
              setErrors([]);
            }}
            className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-gray-50 transition"
          >
            Clear
          </button>
          <button
            onClick={handleUpload}
            disabled={isLoading}
            className="flex-1 bg-black text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:opacity-90 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Confirm Import
          </button>
        </div>
      )}

      {/* ── Step 2: Importing ──────────────────────────────────────── */}
      {step === "importing" && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 flex flex-col items-center text-center">
          <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm font-medium text-gray-700">
            Importing roster data…
          </p>
          <p className="text-xs text-gray-400 mt-1">
            This may take a few seconds.
          </p>
        </div>
      )}

      {/* ── Step 3: Done ───────────────────────────────────────────── */}
      {step === "done" &&
        importResult &&
        (() => {
          const hasChanges =
            importResult.importedMembers > 0 ||
            importResult.updatedMembers > 0 ||
            importResult.importedInstructors > 0 ||
            importResult.updatedInstructors > 0 ||
            importResult.importedAdmins > 0 ||
            importResult.updatedAdmins > 0 ||
            importResult.importedGuardians > 0 ||
            importResult.updatedGuardians > 0;

          return (
            <div className="border border-gray-200 rounded-xl p-6">
              <div className="flex items-center gap-3 mb-5">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${hasChanges ? "bg-green-100" : "bg-gray-100"}`}
                >
                  {hasChanges ? (
                    <svg
                      className="w-4 h-4 text-green-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4 text-gray-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z"
                      />
                    </svg>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-gray-900">
                    {hasChanges ? "Import complete" : "No new updates"}
                  </p>
                  {!hasChanges && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Everything in this file is already up to date.
                    </p>
                  )}
                </div>
              </div>

              {hasChanges &&
                (() => {
                  const newRows = [
                    { label: "Swimmers", value: importResult.importedMembers },
                    {
                      label: "Parents / guardians",
                      value: importResult.importedGuardians,
                    },
                    {
                      label: "Instructors",
                      value: importResult.importedInstructors,
                    },
                    { label: "Admins", value: importResult.importedAdmins },
                  ].filter(({ value }) => value > 0);

                  const updatedRows = [
                    { label: "Swimmers", value: importResult.updatedMembers },
                    {
                      label: "Parents / guardians",
                      value: importResult.updatedGuardians,
                    },
                    {
                      label: "Instructors",
                      value: importResult.updatedInstructors,
                    },
                    { label: "Admins", value: importResult.updatedAdmins },
                  ].filter(({ value }) => value > 0);

                  return (
                    <div className="text-sm text-gray-700 space-y-4">
                      {newRows.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                            New
                          </p>
                          {newRows.map(({ label, value }) => (
                            <div
                              key={label}
                              className="flex justify-between py-2 border-b border-gray-100 last:border-0"
                            >
                              <span className="text-gray-500">{label}</span>
                              <span className="font-medium">{value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {updatedRows.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                            Updated
                          </p>
                          {updatedRows.map(({ label, value }) => (
                            <div
                              key={label}
                              className="flex justify-between py-2 border-b border-gray-100 last:border-0"
                            >
                              <span className="text-gray-500">{label}</span>
                              <span className="font-medium">{value}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}

              <button
                onClick={resetState}
                className="mt-5 w-full border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-gray-50 transition"
              >
                Import another file
              </button>
            </div>
          );
        })()}
    </div>
  );
}
