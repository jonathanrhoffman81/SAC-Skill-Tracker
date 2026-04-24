/**
 * Root layout
 * Purpose: global app layout and providers for the Next.js application (applies to all pages).
 */

import './globals.css';
import AuthListener from '@/components/AuthListener';

export const metadata = {
    title: 'SAC Skill Tracker',
    description: 'Swimming skill tracking app',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <body>
                <AuthListener />
                {children}
            </body>
        </html>
    );
}

