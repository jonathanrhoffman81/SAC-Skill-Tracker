import { useState } from "react";
import Papa from "papaparse";

type SlotConfig = {
  slot: string;
  days: string[];
  time: string;
};

export default function ImportClasses({
  organizationId,
  onImportComplete,
}: {
  organizationId?: string;
  onImportComplete?: () => void;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const [rows, setRows] = useState<any[]>([]);
  const [slots, setSlots] = useState<string[]>([]);
  const [slotConfigs, setSlotConfigs] = useState<Record<string, SlotConfig>>(
    {},
  );

  const [step, setStep] = useState<"upload" | "configure">("upload");
  const [errors, setErrors] = useState<string[]>([]);

  const daysOfWeek = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  // ----------------------
  // FILE HANDLING
  // ----------------------
  const handleFile = (file: File) => {
    if (!file.name.endsWith(".csv")) {
      alert("Only CSV files allowed");
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as any[];

        const uniqueSlots = Array.from(new Set(data.map((r) => r["Slot"])));

        setRows(data);
        setSlots(uniqueSlots);

        const initialSlotConfigs: Record<string, SlotConfig> = {};
        uniqueSlots.forEach((slot) => {
          initialSlotConfigs[slot] = {
            slot,
            days: [],
            time: "",
          };
        });

        setSlotConfigs(initialSlotConfigs);

        setSelectedFile(file);
        setStep("configure");
      },
    });
  };

  // ----------------------
  // UI HELPERS
  // ----------------------
  const toggleDay = (slot: string, day: string) => {
    setSlotConfigs((prev) => {
      const updated = { ...prev };
      const current = updated[slot];

      if (current.days.includes(day)) {
        current.days = current.days.filter((d) => d !== day);
      } else {
        current.days = [...current.days, day];
      }

      return { ...updated };
    });
  };

  // ----------------------
  // UPLOAD
  // ----------------------
  const handleUpload = async () => {
    if (!selectedFile || !organizationId) return;

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("file", selectedFile);
      formData.append("organization_id", organizationId);

      formData.append("slotConfigs", JSON.stringify(slotConfigs));

      const res = await fetch("/api/admin/import-classes", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setSelectedFile(null);
        setStep("upload");
        onImportComplete?.();
      } else {
        setErrors([data.error || "Import failed"]);
      }
    } catch (err: any) {
      setErrors([err.message || "Unexpected error"]);
    } finally {
      setIsLoading(false);
    }
  };

  // ----------------------
  // DRAG DROP
  // ----------------------
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  // ----------------------
  // UI
  // ----------------------
  return (
    <div className="p-4 sm:p-6">
      {step === "upload" && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg sm:rounded-xl p-6 sm:p-10 flex flex-col items-center text-center mb-4 sm:mb-6 transition ${isDragging ? "border-black bg-gray-50" : "border-gray-200"
            }`}
        >
          <p className="font-semibold mb-2">Import Classes</p>

          <input
            type="file"
            accept=".csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
            }}
          />

          {selectedFile && (
            <p className="text-xs mt-2 text-gray-500">{selectedFile.name}</p>
          )}
        </div>
      )}

      {step === "configure" && (
        <div className="space-y-6">
          <p className="font-semibold text-lg">Configure Class Schedules</p>

          {slots.map((slot) => {
            const config = slotConfigs[slot];

            return (
              <div key={slot} className="border p-4 rounded">
                <p className="font-medium">Slot {slot}</p>

                <div className="flex gap-2 flex-wrap mt-2">
                  {daysOfWeek.map((day) => (
                    <button
                      key={day}
                      onClick={() => toggleDay(slot, day)}
                      className={`px-2 py-1 border rounded ${config.days.includes(day) ? "bg-black text-white" : ""
                        }`}
                    >
                      {day}
                    </button>
                  ))}
                </div>

                <input
                  type="time"
                  className="mt-2 border p-2"
                  value={config.time}
                  onChange={(e) =>
                    setSlotConfigs({
                      ...slotConfigs,
                      [slot]: {
                        ...config,
                        time: e.target.value,
                      },
                    })
                  }
                />
              </div>
            );
          })}

          <button
            onClick={handleUpload}
            disabled={isLoading}
            className="bg-black text-white px-4 py-2 rounded"
          >
            {isLoading ? "Importing..." : "Confirm & Import"}
          </button>

          {errors.length > 0 && (
            <div className="text-red-500">
              {errors.map((e, i) => (
                <p key={i}>{e}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
