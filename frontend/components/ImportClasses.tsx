"use client";

import { useState, useCallback } from "react";
import type {
  UniqueClass,
  ParsedSwimRow,
} from "@/app/api/admin/import-classes/route";
import type { ClassSchedule } from "@/app/api/admin/import-classes/confirm/route";

type Step = "upload" | "configure" | "importing" | "done";

interface ParseResult {
  uniqueClasses: UniqueClass[];
  rows: ParsedSwimRow[];
  totalRows: number;
}

interface ConfirmResult {
  classesCreated: number;
  membersCreated: number;
  membersFound: number;
  guardiansCreated: number;
  guardiansLinked: number;
  enrollmentsCreated: number;
  enrollmentErrors: string[];
}

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const DAY_ABBR: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

export default function ImportClasses({
  organizationId,
  onImportComplete,
}: {
  organizationId?: string;
  onImportComplete?: () => void;
}) {
  const [step, setStep] = useState<Step>("upload");
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [schedules, setSchedules] = useState<ClassSchedule[]>([]);
  const [confirmResult, setConfirmResult] = useState<ConfirmResult | null>(
    null,
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [status, setStatus] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["csv", "xls", "xlsx"].includes(ext ?? "")) {
        setErrors(["Only CSV or Excel files are accepted."]);
        return;
      }
      if (!organizationId) {
        setErrors(["Organization ID is missing."]);
        setStatus({ type: "error", message: "Organization ID is missing." });
        return;
      }

      setErrors([]);
      setStatus(null);
      setIsParsing(true);

      try {
        const form = new FormData();
        form.append("file", file);
        form.append("organization_id", organizationId);

        const res = await fetch("/api/admin/import-classes", {
          method: "POST",
          body: form,
        });
        const data = await res.json();

        if (!res.ok) {
          setStatus({
            type: "error",
            message: data.error ?? "Failed to parse file.",
          });
          setErrors([data.error ?? "Failed to parse file."]);
          return;
        }

        const result = data as ParseResult;
        setParseResult(result);

        const newClasses = result.uniqueClasses.filter(
          (c) => !c.already_exists,
        );
        setSchedules(
          newClasses.map((cls) => ({
            name: cls.name,
            length_minutes: cls.length_minutes,
            start_date: "",
            end_date: "",
            schedule_days: [],
            schedule_time: "",
          })),
        );

        setStep("configure");
        setStatus({
          type: "success",
          message:
            "File parsed successfully. Configure class schedules to continue.",
        });
      } catch (err: any) {
        setStatus({
          type: "error",
          message: err.message ?? "Unexpected error.",
        });
        setErrors([err.message ?? "Unexpected error."]);
      } finally {
        setIsParsing(false);
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

  const updateSchedule = (index: number, patch: Partial<ClassSchedule>) => {
    setSchedules((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    );
  };

  const toggleDay = (index: number, day: string) => {
    setSchedules((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        const days = s.schedule_days.includes(day)
          ? s.schedule_days.filter((d) => d !== day)
          : [...s.schedule_days, day];
        return { ...s, schedule_days: days };
      }),
    );
  };

  const handleConfirm = async () => {
    if (!organizationId || !parseResult) return;

    const invalid = schedules.filter((s) => !s.start_date);
    if (invalid.length > 0) {
      setStatus({
        type: "error",
        message: "Please complete required class schedule fields.",
      });
      setErrors([
        `Please set a start date for: ${invalid.map((s) => s.name).join(", ")}`,
      ]);
      return;
    }

    setErrors([]);
    setStatus(null);
    setStep("importing");

    try {
      const res = await fetch("/api/admin/import-classes/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organization_id: organizationId,
          classSchedules: schedules,
          rows: parseResult.rows,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setStatus({ type: "error", message: data.error ?? "Import failed." });
        setErrors([data.error ?? "Import failed."]);
        setStep("configure");
        return;
      }

      setConfirmResult(data as ConfirmResult);
      setStatus({ type: "success", message: "Classes imported successfully." });
      setStep("done");
      onImportComplete?.();
    } catch (err: any) {
      setStatus({ type: "error", message: err.message ?? "Unexpected error." });
      setErrors([err.message ?? "Unexpected error."]);
      setStep("configure");
    }
  };

  const newClasses =
    parseResult?.uniqueClasses.filter((c) => !c.already_exists) ?? [];
  const existingClasses =
    parseResult?.uniqueClasses.filter((c) => c.already_exists) ?? [];
  const hasNewClasses = newClasses.length > 0;

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
            Import Swim Classes
          </p>
          <p className="text-sm text-gray-500 mb-6">
            Upload a SportsEngine "New Registrations Report" export to create
            classes, enrol swimmers, and link parents.
          </p>

          <input
            type="file"
            accept=".csv,.xls,.xlsx"
            className="hidden"
            id="swimClassUpload"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />

          <label
            htmlFor="swimClassUpload"
            className={`cursor-pointer border text-gray-700 text-sm font-medium px-5 py-2.5 rounded-lg transition ${
              isParsing
                ? "border-gray-200 bg-gray-100 text-gray-400 pointer-events-none"
                : "border-gray-300 hover:bg-gray-50"
            }`}
          >
            {isParsing ? "Parsing…" : "Choose file"}
          </label>

          {errors.length > 0 && (
            <div className="mt-4 text-sm text-red-600 space-y-1">
              {errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Step 2: Configure ──────────────────────────────────────── */}
      {step === "configure" && parseResult && (
        <div>
          <div className="mb-6 bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 text-sm text-blue-800">
            <span className="font-semibold">{parseResult.totalRows}</span>{" "}
            registrations across{" "}
            <span className="font-semibold">
              {parseResult.uniqueClasses.length}
            </span>{" "}
            classes — <span className="font-semibold">{newClasses.length}</span>{" "}
            new, <span className="font-semibold">{existingClasses.length}</span>{" "}
            already in the system.
          </div>

          {existingClasses.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                Already in system — keeping existing schedule
              </p>
              <div className="space-y-2">
                {existingClasses.map((cls) => (
                  <div
                    key={cls.name}
                    className="flex items-center justify-between border border-gray-100 bg-gray-50 rounded-xl px-4 py-3"
                  >
                    <div>
                      <p className="text-sm text-gray-700 font-medium">
                        {cls.name}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {cls.length_minutes} min · {cls.member_count} swimmer
                        {cls.member_count !== 1 ? "s" : ""}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded-md">
                      Existing
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {hasNewClasses && (
            <div>
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                New classes — set schedule
              </p>
              <div className="space-y-4">
                {schedules.map((schedule, idx) => {
                  const cls = newClasses.find((c) => c.name === schedule.name);
                  return (
                    <div
                      key={schedule.name}
                      className="border border-gray-200 rounded-xl p-5"
                    >
                      <div className="mb-4">
                        <p className="font-semibold text-gray-900 text-sm">
                          {schedule.name}
                        </p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {schedule.length_minutes} min ·{" "}
                          {cls?.member_count ?? 0} swimmer
                          {(cls?.member_count ?? 0) !== 1 ? "s" : ""}
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            Start date <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="date"
                            value={schedule.start_date}
                            onChange={(e) =>
                              updateSchedule(idx, {
                                start_date: e.target.value,
                              })
                            }
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">
                            End date
                          </label>
                          <input
                            type="date"
                            value={schedule.end_date}
                            onChange={(e) =>
                              updateSchedule(idx, { end_date: e.target.value })
                            }
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                          />
                        </div>
                      </div>

                      <div className="mb-4">
                        <label className="block text-xs font-medium text-gray-600 mb-2">
                          Days of week
                        </label>
                        <div className="flex flex-wrap gap-2">
                          {DAYS.map((day) => {
                            const active = schedule.schedule_days.includes(day);
                            return (
                              <button
                                key={day}
                                onClick={() => toggleDay(idx, day)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                                  active
                                    ? "bg-black text-white border-black"
                                    : "bg-white text-gray-700 border-gray-300 hover:border-gray-400"
                                }`}
                              >
                                {DAY_ABBR[day]}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Class time
                        </label>
                        <input
                          type="time"
                          value={schedule.schedule_time}
                          onChange={(e) =>
                            updateSchedule(idx, {
                              schedule_time: e.target.value,
                            })
                          }
                          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {errors.length > 0 && (
            <div className="mt-4 text-sm text-red-600 space-y-1">
              {errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}

          <div className="mt-6 flex gap-3">
            <button
              onClick={() => {
                setStep("upload");
                setParseResult(null);
                setErrors([]);
              }}
              className="flex-1 border border-gray-300 text-gray-700 text-sm font-medium px-4 py-2.5 rounded-lg hover:bg-gray-50 transition"
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              className="flex-1 bg-black text-white text-sm font-medium px-4 py-2.5 rounded-lg hover:opacity-90 transition"
            >
              Confirm Import
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Importing ──────────────────────────────────────── */}
      {step === "importing" && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 flex flex-col items-center text-center">
          <div className="w-8 h-8 border-2 border-black border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-sm font-medium text-gray-700">
            Importing classes, enrollments, and linking parents…
          </p>
          <p className="text-xs text-gray-400 mt-1">
            This may take a few seconds.
          </p>
        </div>
      )}

      {/* ── Step 4: Done ───────────────────────────────────────────── */}
      {step === "done" &&
        confirmResult &&
        (() => {
          const hasChanges =
            confirmResult.classesCreated > 0 ||
            confirmResult.membersCreated > 0 ||
            confirmResult.guardiansCreated > 0 ||
            confirmResult.guardiansLinked > 0 ||
            confirmResult.enrollmentsCreated > 0;

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
                <div className="text-sm text-gray-700">
                  {[
                    {
                      label: "New classes created",
                      value: confirmResult.classesCreated,
                    },
                    {
                      label: "New swimmers created",
                      value: confirmResult.membersCreated,
                    },
                    {
                      label: "New parent accounts created",
                      value: confirmResult.guardiansCreated,
                    },
                    {
                      label: "Existing parents linked",
                      value: confirmResult.guardiansLinked,
                    },
                    {
                      label: "Enrollments created",
                      value: confirmResult.enrollmentsCreated,
                    },
                  ]
                    .filter(({ value }) => value > 0)
                    .map(({ label, value }) => (
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

              {confirmResult.enrollmentErrors.length > 0 && (
                <div className="mt-4 text-sm text-red-600 space-y-1">
                  <p className="font-medium">Some enrollments failed:</p>
                  {confirmResult.enrollmentErrors.map((e, i) => (
                    <p key={i} className="text-xs">
                      {e}
                    </p>
                  ))}
                </div>
              )}

              <button
                onClick={() => {
                  setStep("upload");
                  setParseResult(null);
                  setSchedules([]);
                  setConfirmResult(null);
                  setErrors([]);
                }}
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
