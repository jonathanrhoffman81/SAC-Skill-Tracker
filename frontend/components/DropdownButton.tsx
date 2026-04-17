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
}: {
    value: string;
    onChange: (value: string) => void;
    options: DropdownOption[];
    placeholder?: string;
    className?: string;
    ariaLabel?: string;
}) {
    const [open, setOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement | null>(null);

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

    return (
        <div ref={wrapperRef} className={`relative ${className}`}>
            <button
                type="button"
                aria-label={ariaLabel}
                onClick={() => setOpen((prev) => !prev)}
                className="w-full h-10 border border-slate-300 bg-white text-left text-slate-900 text-xs sm:text-sm px-3 pr-8 rounded-xl outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-500"
            >
                <span className="block truncate">{selectedLabel}</span>
            </button>

            <svg
                className={`pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 transition-transform ${open ? "rotate-180" : ""}`}
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
            >
                <path d="M5 7.5L10 12.5L15 7.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>

            {open && (
                <div className="absolute left-0 z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                    {options.map((option) => {
                        const isSelected = option.value === value;

                        return (
                            <button
                                key={option.value}
                                type="button"
                                disabled={option.disabled}
                                onClick={() => {
                                    onChange(option.value);
                                    setOpen(false);
                                }}
                                className={`flex w-full items-center justify-between px-2.5 py-1.5 text-left text-xs sm:text-sm ${isSelected
                                    ? "bg-sky-50 text-sky-700"
                                    : "text-slate-700 hover:bg-slate-50"} disabled:cursor-not-allowed disabled:opacity-50`}
                            >
                                <span className="truncate">{option.label}</span>
                                {isSelected && <span className="text-[11px]">✓</span>}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
