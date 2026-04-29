const palette = [
    { bg: 'bg-blue-100', text: 'text-blue-800' },
    { bg: 'bg-emerald-100', text: 'text-emerald-800' },
    { bg: 'bg-amber-100', text: 'text-amber-800' },
    { bg: 'bg-fuchsia-100', text: 'text-fuchsia-800' },
    { bg: 'bg-cyan-100', text: 'text-cyan-800' },
    { bg: 'bg-lime-100', text: 'text-lime-800' },
    { bg: 'bg-rose-100', text: 'text-rose-800' },
    { bg: 'bg-violet-100', text: 'text-violet-800' },
    { bg: 'bg-orange-100', text: 'text-orange-800' },
    { bg: 'bg-teal-100', text: 'text-teal-800' },
    { bg: 'bg-indigo-100', text: 'text-indigo-800' },
    { bg: 'bg-pink-100', text: 'text-pink-800' },
];

export function getClassTagColors(className: string): { bg: string; text: string } {
    const hash = className
        .toLowerCase()
        .split('')
        .reduce((total, char) => total + char.charCodeAt(0), 0);
    return palette[hash % palette.length];
}
