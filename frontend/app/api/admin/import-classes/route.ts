import { NextRequest, NextResponse } from 'next/server';
import Papa from 'papaparse';
import { getSupabaseAdminClient } from '@/lib/supabaseAdmin';
import { getOrgIdByEmail } from '@/lib/adminQueries';

interface ParsedClassRow {
    name: string;
    schedule: string | null;
    lengthMinutes: number | null;
}

function normalizeHeader(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
}

function getFirstValue(row: Record<string, unknown>, keys: string[]): string {
    for (const key of keys) {
        const value = row[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return '';
}

function parseCsvRows(text: string): { rows: ParsedClassRow[]; errors: string[] } {
    const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
    });

    if (parsed.errors.length > 0) {
        return {
            rows: [],
            errors: parsed.errors.map((err) => err.message).slice(0, 10),
        };
    }

    const rows: ParsedClassRow[] = [];
    const errors: string[] = [];

    (parsed.data || []).forEach((rawRow, index) => {
        const rowNumber = index + 2;
        const normalizedRow: Record<string, unknown> = {};

        Object.entries(rawRow || {}).forEach(([key, value]) => {
            normalizedRow[normalizeHeader(key)] = value;
        });

        const name = getFirstValue(normalizedRow, ['name', 'class_name', 'classname']);
        const scheduleRaw = getFirstValue(normalizedRow, ['schedule']);
        const lengthRaw = getFirstValue(normalizedRow, [
            'length_minutes',
            'length',
            'duration',
            'duration_minutes',
        ]);

        if (!name) {
            errors.push(`Row ${rowNumber}: Missing class name (column 'name').`);
            return;
        }

        let lengthMinutes: number | null = null;
        if (lengthRaw) {
            const parsedLength = Number.parseInt(lengthRaw, 10);
            if (Number.isNaN(parsedLength) || parsedLength <= 0) {
                errors.push(`Row ${rowNumber}: Invalid length_minutes '${lengthRaw}'.`);
                return;
            }
            lengthMinutes = parsedLength;
        }

        rows.push({
            name,
            schedule: scheduleRaw || null,
            lengthMinutes,
        });
    });

    return { rows, errors };
}

export async function POST(request: NextRequest) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const email = (formData.get('email') as string | null)?.trim();

        if (!file || !email) {
            return NextResponse.json(
                { error: 'File and email are required.' },
                { status: 400 }
            );
        }

        const text = await file.text();
        if (!text.trim()) {
            return NextResponse.json(
                { error: 'CSV file is empty.' },
                { status: 400 }
            );
        }

        const { rows, errors } = parseCsvRows(text);

        if (errors.length > 0) {
            return NextResponse.json(
                {
                    error: 'CSV validation failed.',
                    errors: errors.slice(0, 20),
                },
                { status: 400 }
            );
        }

        if (rows.length === 0) {
            return NextResponse.json(
                { error: 'No valid rows found in CSV.' },
                { status: 400 }
            );
        }

        const dedupedByName = new Map<string, ParsedClassRow>();
        rows.forEach((row) => {
            const key = row.name.trim().toLowerCase();
            dedupedByName.set(key, row);
        });

        const uniqueRows = Array.from(dedupedByName.values());
        const skippedRows = rows.length - uniqueRows.length;

        const supabase = getSupabaseAdminClient();
        const organizationId = await getOrgIdByEmail(supabase, email);

        if (!organizationId) {
            return NextResponse.json(
                { error: 'Failed to resolve organization for this admin.' },
                { status: 400 }
            );
        }

        const { data: existingRows, error: existingError } = await supabase
            .from('class_entity')
            .select('class_id, name')
            .eq('organization_id', organizationId);

        if (existingError) {
            return NextResponse.json(
                { error: `Failed to load existing classes: ${existingError.message}` },
                { status: 500 }
            );
        }

        const existingByName = new Map<string, { class_id: string; name: string }>();
        (existingRows || []).forEach((row) => {
            existingByName.set(row.name.trim().toLowerCase(), row);
        });

        let insertedClasses = 0;
        let updatedClasses = 0;

        for (const row of uniqueRows) {
            const key = row.name.trim().toLowerCase();
            const existing = existingByName.get(key);

            if (existing) {
                const { error: updateError } = await supabase
                    .from('class_entity')
                    .update({
                        name: row.name,
                        schedule: row.schedule,
                        length_minutes: row.lengthMinutes,
                    })
                    .eq('class_id', existing.class_id);

                if (updateError) {
                    return NextResponse.json(
                        {
                            error: `Failed to update class '${row.name}': ${updateError.message}`,
                        },
                        { status: 500 }
                    );
                }

                updatedClasses += 1;
                continue;
            }

            const { error: insertError } = await supabase.from('class_entity').insert({
                organization_id: organizationId,
                name: row.name,
                schedule: row.schedule,
                length_minutes: row.lengthMinutes,
            });

            if (insertError) {
                return NextResponse.json(
                    {
                        error: `Failed to insert class '${row.name}': ${insertError.message}`,
                    },
                    { status: 500 }
                );
            }

            insertedClasses += 1;
        }

        return NextResponse.json({
            success: true,
            insertedClasses,
            updatedClasses,
            totalProcessed: uniqueRows.length,
            skippedRows,
        });
    } catch (error) {
        console.error('Import classes error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
