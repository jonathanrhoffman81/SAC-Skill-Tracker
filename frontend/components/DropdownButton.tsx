"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type DropdownOption = {
    value: string;
    label: string;
    disabled?: boolean;
};

export default function DropdownButton({
    value,
    onChange,
    options,
    placeholder = "Select",
    className = "",
    ariaLabel,
    ui = "slate",
}: {
    value: string;
    onChange: (value: string) => void;
    options: DropdownOption[];
    placeholder?: string;
    className?: string;
    ariaLabel?: string;
    ui?: "slate" | "app";
}) {
    const [open, setOpen] = useState(false);
    const [openUpward, setOpenUpward] = useState(false);
    const [panelMaxHeight, setPanelMaxHeight] = useState(224);
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;

        const updatePanelLayout = () => {
            const rect = wrapperRef.current?.getBoundingClientRect();
            if (!rect) return;

            const viewportHeight = window.innerHeight;
            const viewportPadding = 12;
            const panelGap = 6;

            const availableBelow = Math.max(
                120,
                viewportHeight - rect.bottom - viewportPadding - panelGap,
            );
            const availableAbove = Math.max(
                120,
                rect.top - viewportPadding - panelGap,
            );

            const shouldOpenUpward = availableBelow < 180 && availableAbove > availableBelow;
            setOpenUpward(shouldOpenUpward);
            setPanelMaxHeight(shouldOpenUpward ? availableAbove : availableBelow);
        };

        updatePanelLayout();
        window.addEventListener("resize", updatePanelLayout);
        window.addEventListener("scroll", updatePanelLayout, true);

        return () => {
            window.removeEventListener("resize", updatePanelLayout);
            window.removeEventListener("scroll", updatePanelLayout, true);
        };
    }, [open]);

    useEffect(() => {
        const onClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            if (!wrapperRef.current?.contains(target)) {
                setOpen(false);
            }
        };

        document.addEventListener("mousedown", onClickOutside);
        return () => document.removeEventListener("mousedown", onClickOutside);
    }, []);

    const selectedLabel = useMemo(() => {
        return options.find((option) => option.value === value)?.label || placeholder;
    }, [options, placeholder, value]);

    const triggerClassName =
        ui === "app"
            ? "w-full h-10 border border-gray-300 bg-white text-left text-gray-700 text-sm px-3 pr-8 rounded-md shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500"
            : "w-full h-10 border border-slate-300 bg-white text-left text-slate-900 text-xs sm:text-sm px-3 pr-8 rounded-xl outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500";

    const iconClassName =
        ui === "app"
            ? "pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 transition-transform"
            : "pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-transform";

    const panelClassName =
        ui === "app"
            ? "absolute left-0 z-50 w-full overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-md"
            : "absolute left-0 z-50 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg";

    return (
        <div ref={wrapperRef} className={`relative ${className}`}>
            <button
                type="button"
                aria-label={ariaLabel}
                onClick={() => setOpen((prev) => !prev)}
                className={triggerClassName}
                title={selectedLabel}
            >
                <span className="block truncate">{selectedLabel}</span>
            </button>

            <svg
                className={`${iconClassName} ${open ? "rotate-180" : ""}`}
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            >
                <path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>

            {open && (
                <div
                    className={`${panelClassName} ${openUpward ? "bottom-full mb-1" : "top-full mt-1"
                        }`}
                    style={{ maxHeight: panelMaxHeight }}
                >
                    {options.map((option) => {
                        const isSelected = option.value === value;

                        const optionClassName =
                            ui === "app"
                                ? isSelected
                                    ? "bg-blue-50 text-blue-700"
                                    : "text-gray-700 hover:bg-gray-50"
                                : isSelected
                                    ? "bg-sky-50 text-sky-700"
                                    : "text-slate-700 hover:bg-slate-50";

                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={option.disabled}
                                onClick={() => {
                                    onChange(option.value);
                                    setOpen(false);
                                }}
                                className={`flex w-full items-start justify-between gap-2 px-2.5 py-1.5 text-left text-xs sm:text-sm ${optionClassName} disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                                <span
                                    className="min-w-0 flex-1 whitespace-normal break-words leading-snug"
                                    title={option.label}
                                >
                                    {option.label}
                                </span>
                                {isSelected && <span className="text-[11px]">✓</span>}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
