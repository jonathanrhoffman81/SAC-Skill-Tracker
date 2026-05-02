"use client";

import { useState, useCallback } from "react";
import * as XLSX from "xlsx";
import { authFetch } from "@/lib/clientAuth";

type Step = "upload" | "importing" | "done";

interface ImportResult {
  importedMembers: number;
  updatedMembers: number;
  importedGuardians: number;
  updatedGuardians: number;
  importedInstructors: number;
  updatedInstructors: number;
  importedAdmins: number;
  updatedAdmins: number;
}

// Required columns — billing group and member status removed,
// member name is optional (account-only rows are valid)
const REQUIRED_HEADERS = [
  "Acct. First Name",
  "Acct. Last Name",
  "Email",
  "Account Status",
];

const TEMPLATE_PATH = "/roster_import_template.xlsx";

/**
 * Parse CSV or Excel file into an array of row-objects keyed by the header row.
 * Returns { headers, rows } or throws with a user-facing message.
 */
async function parseFile(
  file: File,
): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  let grid: string[][] = [];

  if (ext === "csv") {
    const text = await file.text();
    // Dynamically import PapaParse to keep bundle split clean
    const Papa = (await import("papaparse")).default;
    const result = Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: true,
    });
    grid = (result.data as string[][]).map((row) =>
      row.map((c) => String(c ?? "").trim()),
    );
  } else if (ext === "xls" || ext === "xlsx") {
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<string[]>(sheet, {
      header: 1,
      defval: "",
      raw: false,
    });
    grid = (raw as unknown as string[][]).map((row) =>
      row.map((c) => String(c ?? "").trim()),
    );
  } else {
    throw new Error("Only CSV, XLS, or XLSX files are accepted.");
  }

  if (grid.length < 2) throw new Error("File appears to be empty.");

  const headers = grid[0];
  const colIndex: Record<string, number> = {};
  headers.forEach((h, i) => {
    if (h) colIndex[h] = i;
  });

  const missing = REQUIRED_HEADERS.filter((h) => !(h in colIndex));
  if (missing.length > 0) {
    throw new Error(`Missing required columns: ${missing.join(", ")}`);
  }

  const rows: Record<string, string>[] = grid.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    return obj;
  });

  return { headers, rows };
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
  const [validatedRowCount, setValidatedRowCount] = useState<number>(0);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const resetFileState = () => {
    setSelectedFile(null);
    setValidatedRowCount(0);
    setErrors([]);
    setStatus(null);
  };

  const handleFile = useCallback(
    async (file: File) => {
      // Reset all file-related state so a newly chosen file always starts fresh
      resetFileState();

      if (!organizationId) {
        setStatus({ type: "error", message: "Organization ID is missing." });
        return;
      }

      try {
        const { rows } = await parseFile(file);

        // Filter to rows that have at minimum an email
        const dataRows = rows.filter(
          (r) => r["Email"]?.trim() && r["Email"].includes("@"),
        );

        if (dataRows.length === 0) {
          setErrors([
            "No valid data rows found. Check that Email is filled in.",
          ]);
          setStatus({ type: "error", message: "No valid rows found." });
          return;
        }

        // Per-row validation (only hard errors — missing account name/email)
        const validationErrors: string[] = [];
        dataRows.forEach((row, idx) => {
          const rowNum = idx + 2;
          if (!row["Acct. First Name"]?.trim())
            validationErrors.push(`Row ${rowNum}: Missing account first name`);
          if (!row["Acct. Last Name"]?.trim())
            validationErrors.push(`Row ${rowNum}: Missing account last name`);
          if (!row["Email"]?.trim())
            validationErrors.push(`Row ${rowNum}: Missing email`);
          if (row["Email"] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row["Email"]))
            validationErrors.push(`Row ${rowNum}: Invalid email format`);

          // Member Status and DOB are required when a swimmer name is present
          const hasMember = !!(
            row["Memb. First Name"]?.trim() && row["Memb. Last Name"]?.trim()
          );
          if (hasMember && !row["Member Status"]?.trim())
            validationErrors.push(
              `Row ${rowNum}: Member Status is required when a swimmer name is present`,
            );
          if (hasMember && !row["Birthday"]?.trim())
            validationErrors.push(
              `Row ${rowNum}: Date of Birth (Birthday) is required when a swimmer name is present`,
            );
        });

        if (validationErrors.length > 0) {
          setErrors(validationErrors.slice(0, 10));
          setStatus({ type: "error", message: "Validation failed." });
          return;
        }

        setSelectedFile(file);
        setValidatedRowCount(dataRows.length);
        setStatus({
          type: "success",
          message: `File validated — ${dataRows.length} rows ready to import.`,
        });
      } catch (err: any) {
        setErrors([err.message ?? "Failed to parse file."]);
        setStatus({
          type: "error",
          message: err.message ?? "Failed to parse file.",
        });
      }
    },
    [organizationId],
  );

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
          importedMembers: data.importedMembers ?? 0,
          updatedMembers: data.updatedMembers ?? 0,
          importedGuardians: data.importedGuardians ?? 0,
          updatedGuardians: data.updatedGuardians ?? 0,
          importedInstructors: data.importedInstructors ?? 0,
          updatedInstructors: data.updatedInstructors ?? 0,
          importedAdmins: data.importedAdmins ?? 0,
          updatedAdmins: data.updatedAdmins ?? 0,
        });
        setStatus({
          type: "success",
          message: "Roster imported successfully.",
        });
        setStep("done");
        onImportComplete?.();
      } else {
        setStatus({ type: "error", message: data.error ?? "Import failed." });
        setErrors([data.error ?? "Import failed."]);
        setStep("upload");
      }
    } catch (err: any) {
      setStatus({ type: "error", message: err.message ?? "Unexpected error." });
      setErrors([err.message ?? "Unexpected error."]);
      setStep("upload");
    } finally {
      setIsLoading(false);
    }
  };

  const resetState = () => {
    setStep("upload");
    setSelectedFile(null);
    setValidatedRowCount(0);
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
        <div>
          {/* Template download banner */}
          <div className="mb-4 flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-blue-900">
                Need the right format?
              </p>
              <p className="text-xs text-blue-600 mt-0.5">
                Download the Excel template — it includes all required columns
                and example rows.
              </p>
            </div>
            <a
              href={TEMPLATE_PATH}
              download="roster_import_template.xlsx"
              className="ml-4 shrink-0 flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white px-3 py-2 text-xs font-medium text-blue-700 hover:bg-blue-50 transition"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 4v11"
                />
              </svg>
              Download template
            </a>
          </div>

          {/* Drop zone */}
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
            <p className="text-sm text-gray-500 mb-1">
              Import swimmer roster and account holders from SportsEngine.
            </p>
            <p className="text-xs text-gray-400 mb-6">
              Accepts CSV, XLS, or XLSX
            </p>

            <input
              type="file"
              accept=".csv,.xls,.xlsx"
              className="hidden"
              id="rosterUpload"
              // Use a key to force the input to re-mount when the file is cleared,
              // so choosing the same filename again triggers onChange reliably.
              key={selectedFile ? selectedFile.name : "empty"}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />

            <label
              htmlFor="rosterUpload"
              className={`cursor-pointer border text-gray-700 text-sm font-medium px-5 py-2.5 rounded-lg transition ${
                isLoading
                  ? "border-gray-200 bg-gray-100 text-gray-400 pointer-events-none"
                  : "border-gray-300 hover:bg-gray-50"
              }`}
            >
              Choose file
            </label>

            {selectedFile && (
              <p className="mt-2 text-xs text-gray-500">
                {selectedFile.name} · {validatedRowCount} rows
              </p>
            )}

            {errors.length > 0 && (
              <div className="mt-4 text-sm text-red-600 space-y-1 text-left w-full max-w-sm">
                {errors.map((err, i) => (
                  <p key={i}>{err}</p>
                ))}
              </div>
            )}
          </div>

          {/* Confirm / Clear buttons */}
          {selectedFile && errors.length === 0 && (
            <div className="mt-4 flex gap-3">
              <button
                onClick={resetFileState}
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
            importResult.importedGuardians > 0 ||
            importResult.updatedGuardians > 0 ||
            importResult.importedInstructors > 0 ||
            importResult.updatedInstructors > 0 ||
            importResult.importedAdmins > 0 ||
            importResult.updatedAdmins > 0;

          const newRows = [
            { label: "Swimmers", value: importResult.importedMembers },
            {
              label: "Parents / guardians",
              value: importResult.importedGuardians,
            },
            { label: "Instructors", value: importResult.importedInstructors },
            { label: "Admins", value: importResult.importedAdmins },
          ].filter(({ value }) => value > 0);

          const updatedRows = [
            { label: "Swimmers", value: importResult.updatedMembers },
            {
              label: "Parents / guardians",
              value: importResult.updatedGuardians,
            },
            { label: "Instructors", value: importResult.updatedInstructors },
            { label: "Admins", value: importResult.updatedAdmins },
          ].filter(({ value }) => value > 0);

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

              {hasChanges && (
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
              )}

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
