"use client";

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from "@/lib/clientAuth";

interface SkillItem {
  id: string;
  name: string;
  progress: 0 | 1 | 2 | 3 | 4;
  // True when the swimmer actually has a recorded progress entry for this
  // skill. Used to distinguish "evaluated as 0" from "never evaluated"
  // when seeding the form's chip selection.
  hasProgressHistory?: boolean;
  mastered: boolean;
  dateAcquired?: string;
}

interface ClassItem {
  id: string;
  name: string;
  schedule: string;
}

interface EvaluationFormProps {
  swimmerId: string;
  skills: SkillItem[];
  classes: ClassItem[];
  initialClassId?: string;
  editingEvaluation?: {
    evaluationId: string;
    classId?: string;
    isSkillNote: boolean;
    skillId?: string;
    feedback?: string;
  };
  onSubmissionComplete?: (result: {
    mode: 'create' | 'edit';
    classId?: string;
    note?: string;
    skillNotes: Array<{ skillId: string; skillName: string; note: string }>;
    skillUpdates: Array<{ skillId: string; progress: SkillItem['progress'] }>;
    savedAt: string;
    createdEvaluations?: Array<{
      evaluation_id: string;
      class_id: string | null;
      skill_id: string | null;
      feedback: string | null;
      evaluation_date: string;
    }>;
  }) => void;
  closeDelayMs?: number;
  viewOnly?: boolean;
  // When viewing an existing evaluation, the host can pass every entry
  // from the same session here so the form can populate per-skill notes
  // and the session-level feedback all at once. Without this only the
  // single clicked entry appears, leaving every other skill blank.
  sessionEntries?: Array<{
    isSkillNote: boolean;
    skillName?: string;
    feedback?: string;
  }>;
  onDirtyChange?: (isDirty: boolean) => void;
}

const PROGRESS_OPTIONS: Array<{ value: 0 | 1 | 2 | 3 | 4; label: string }> = [
  { value: 0, label: '0 - Not started' },
  { value: 1, label: '1 - Beginning' },
  { value: 2, label: '2 - Developing' },
  { value: 3, label: '3 - Nearly there' },
  { value: 4, label: '4 - Acquired' },
];

const PROGRESS_DESCRIPTIONS: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'Unable to attempt the skill',
  1: 'Unable to show skill without significant support',
  2: 'Inconsistently or with support is able to demonstrate the skill',
  3: 'Consistently demonstrates application of the skill',
  4: 'Demonstrates complete understanding of the skill',
};

function proficiencyToPercentage(level: 0 | 1 | 2 | 3 | 4): number {
  const mapping: Record<number, number> = { 0: 0, 1: 25, 2: 50, 3: 75, 4: 100 };
  return mapping[level];
}

export default function EvaluationForm({
  swimmerId,
  skills,
  classes,
  initialClassId,
  editingEvaluation,
  onSubmissionComplete,
  closeDelayMs = 1200,
  viewOnly = false,
  sessionEntries,
  onDirtyChange,
}: EvaluationFormProps) {
  // null = "not evaluated this session" / skipped. Skills left at null are
  // excluded from the submitted skillUpdates so no member_skill row is written
  // for skills that weren't relevant for this swimmer this session.
  type ProgressValue = SkillItem['progress'] | null;
  const [progressBySkillId, setProgressBySkillId] = useState<Record<string, ProgressValue>>({});
  const [initialProgressBySkillId, setInitialProgressBySkillId] = useState<Record<string, ProgressValue>>({});
  const [skillNotesBySkillId, setSkillNotesBySkillId] = useState<Record<string, string>>({});
  const [expandedNoteSkillIds, setExpandedNoteSkillIds] = useState<Set<string>>(new Set());
  const [selectedClassId, setSelectedClassId] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    // Carry through any skill that has actual recorded progress (a real
    // member_skill row, even if its value is 0). Skills with no recorded
    // progress start unselected so the instructor isn't presented with
    // misleading "0" defaults. Same rule for new and edit modes — what the
    // instructor sees as "selected" matches what the swimmer actually has.
    const nextProgress = Object.fromEntries(
      skills.map((skill) => {
        // Prefer the API's explicit signal; fall back to the heuristic
        // "progress > 0" for callers (older swimmer-detail pages) that
        // don't supply hasProgressHistory yet.
        const hasHistory = skill.hasProgressHistory ?? skill.progress > 0;
        const initial: ProgressValue = hasHistory ? skill.progress : null;
        return [skill.id, initial];
      }),
    ) as Record<string, ProgressValue>;

    setProgressBySkillId(nextProgress);
    setInitialProgressBySkillId(nextProgress);
    setSkillNotesBySkillId({});
  }, [skills, editingEvaluation]);

  useEffect(() => {
    if (!editingEvaluation) {
      setNote('');
      setSkillNotesBySkillId({});
      return;
    }

    // If the host gave us the full set of entries for this session, hydrate
    // every per-skill note and the anchor's class-level feedback at once.
    // Otherwise we'd only show the single entry the user happened to click.
    if (sessionEntries && sessionEntries.length > 0) {
      const skillIdByName = new Map(skills.map((s) => [s.name, s.id]));
      const notesMap: Record<string, string> = {};
      let anchorFeedback = '';
      for (const entry of sessionEntries) {
        const text = entry.feedback?.trim();
        if (!text) continue;
        if (entry.isSkillNote && entry.skillName) {
          const id = skillIdByName.get(entry.skillName);
          if (id) notesMap[id] = entry.feedback ?? '';
        } else if (!entry.isSkillNote) {
          anchorFeedback = entry.feedback ?? '';
        }
      }
      setNote(anchorFeedback);
      setSkillNotesBySkillId(notesMap);
      setExpandedNoteSkillIds(new Set(Object.keys(notesMap)));
      return;
    }

    if (editingEvaluation.isSkillNote && editingEvaluation.skillId) {
      setNote('');
      setSkillNotesBySkillId({
        [editingEvaluation.skillId]: editingEvaluation.feedback ?? '',
      });
      setExpandedNoteSkillIds(new Set([editingEvaluation.skillId]));
      return;
    }

    setNote(editingEvaluation.feedback ?? '');
    setSkillNotesBySkillId({});
  }, [editingEvaluation, sessionEntries, skills]);

  useEffect(() => {
    if (initialClassId && classes.some((classItem) => classItem.id === initialClassId)) {
      setSelectedClassId(initialClassId);
      return;
    }

    setSelectedClassId((current) => {
      if (current && classes.some((classItem) => classItem.id === current)) {
        return current;
      }
      return classes[0]?.id ?? '';
    });
  }, [classes, initialClassId]);

  const changedSkillUpdates = useMemo(
    () =>
      skills
        .map((skill) => ({
          skillId: skill.id,
          progress: progressBySkillId[skill.id] ?? null,
          initialProgress: initialProgressBySkillId[skill.id] ?? null,
        }))
        // Skills left at "Skip" are intentionally excluded from the write set.
        .filter((skill): skill is { skillId: string; progress: SkillItem['progress']; initialProgress: ProgressValue } =>
          skill.progress !== null,
        )
        .filter((skill) => skill.progress !== skill.initialProgress)
        .map((skill) => ({
          skillId: skill.skillId,
          progress: skill.progress,
        })),
    [initialProgressBySkillId, progressBySkillId, skills]
  );

  const handleProgressChange = (skillId: string, progress: ProgressValue) => {
    setProgressBySkillId((prev) => ({
      ...prev,
      [skillId]: progress,
    }));
    setSuccessMessage('');
  };

  const skillNoteEntries = useMemo(
    () =>
      skills
        .map((skill) => ({
          skillId: skill.id,
          skillName: skill.name,
          note: skillNotesBySkillId[skill.id]?.trim() ?? '',
        }))
        .filter((entry) => entry.note.length > 0),
    [skillNotesBySkillId, skills]
  );

  // Surface a "dirty" signal so the host UI can warn the user before they
  // close the form and lose unsaved progress changes / notes.
  const initialNoteValue = (editingEvaluation?.feedback ?? '').trim();
  const isDirty =
    !viewOnly &&
    (changedSkillUpdates.length > 0 ||
      skillNoteEntries.length > 0 ||
      note.trim() !== initialNoteValue);

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Make sure we don't leave a stale "dirty" flag behind in the parent when
  // the form unmounts (e.g. after a successful close).
  useEffect(() => {
    return () => {
      onDirtyChange?.(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const extraSkillNoteEntriesForEdit = useMemo(() => {
    if (!editingEvaluation) {
      return [];
    }

    return skillNoteEntries.filter((entry) => {
      if (!editingEvaluation.isSkillNote || !editingEvaluation.skillId) {
        return true;
      }
      return entry.skillId !== editingEvaluation.skillId;
    });
  }, [editingEvaluation, skillNoteEntries]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedNote = note.trim();
    const editingSkillNoteText = editingEvaluation?.isSkillNote && editingEvaluation.skillId
      ? (skillNotesBySkillId[editingEvaluation.skillId]?.trim() ?? '')
      : '';
    const hasEditingFeedback = editingEvaluation
      ? editingEvaluation.isSkillNote
        ? editingSkillNoteText.length > 0 || Boolean(editingEvaluation.feedback)
        : trimmedNote.length > 0 || Boolean(editingEvaluation.feedback)
      : false;

    if (viewOnly) {
      return;
    }

    setIsSubmitting(true);
    setError('');
    setSuccessMessage('');

    try {
      const headers = { 'Content-Type': 'application/json' };

      let createdEvaluations: Array<{
        evaluation_id: string;
        class_id: string | null;
        skill_id: string | null;
        feedback: string | null;
        evaluation_date: string;
      }> = [];

      const parseJsonPayload = async (response: Response) => {
        const responseText = await response.text();
        let payload: { error?: string; createdEvaluations?: typeof createdEvaluations } = {};

        if (responseText.trim()) {
          try {
            payload = JSON.parse(responseText) as typeof payload;
          } catch {
            const fallbackMessage = response.ok
              ? 'The server returned an unexpected response.'
              : `The server returned an unexpected ${response.status} error page.`;
            throw new Error(fallbackMessage);
          }
        }

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to submit evaluation.');
        }

        return payload;
      };

      if (editingEvaluation) {
        if (changedSkillUpdates.length > 0) {
          for (const update of changedSkillUpdates) {
            const progressResponse = await authFetch(`/api/instructor/swimmers/${swimmerId}`, {
              method: 'PATCH',
              headers,
              body: JSON.stringify({
                skillId: update.skillId,
                progress: update.progress,
                // Link the new member_skill row to the evaluation we're
                // editing so it stays associated with this class. Without
                // this, edits drop class linkage and disappear from
                // class-history views once the class window closes.
                evaluationId: editingEvaluation.evaluationId,
              }),
            });

            await parseJsonPayload(progressResponse);
          }
        }

        const feedbackToSave = editingEvaluation.isSkillNote
          ? editingSkillNoteText
          : trimmedNote;

        const editResponse = await authFetch(`/api/instructor/swimmers/${swimmerId}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({
            evaluationId: editingEvaluation.evaluationId,
            feedback: feedbackToSave || '',
          }),
        });

        await parseJsonPayload(editResponse);

        if (extraSkillNoteEntriesForEdit.length > 0) {
          const addSkillNotesResponse = await authFetch(`/api/instructor/swimmers/${swimmerId}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
              classId: selectedClassId || editingEvaluation.classId || undefined,
              skillNotes: extraSkillNoteEntriesForEdit.map((entry) => ({
                skillId: entry.skillId,
                note: entry.note,
              })),
            }),
          });

          const addSkillNotesPayload = await parseJsonPayload(addSkillNotesResponse);
          createdEvaluations = addSkillNotesPayload.createdEvaluations ?? [];
        }
      } else {
        const response = await authFetch(`/api/instructor/swimmers/${swimmerId}`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            classId: selectedClassId || undefined,
            note: trimmedNote || undefined,
            skillNotes: skillNoteEntries.map((entry) => ({
              skillId: entry.skillId,
              note: entry.note,
            })),
            skillUpdates: changedSkillUpdates,
          }),
        });

        const payload = await parseJsonPayload(response);
        createdEvaluations = payload.createdEvaluations ?? [];
      }

      const nextProgress = Object.fromEntries(
        skills.map((skill) => [skill.id, progressBySkillId[skill.id] ?? null])
      ) as Record<string, ProgressValue>;

      setInitialProgressBySkillId(nextProgress);
      setSkillNotesBySkillId({});
      setNote('');
      setSuccessMessage(editingEvaluation ? 'Evaluation updated.' : 'Evaluation saved.');
      if (onSubmissionComplete) {
        const savedAt = new Date().toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });
        window.setTimeout(() => {
          onSubmissionComplete({
            mode: editingEvaluation ? 'edit' : 'create',
            classId: selectedClassId || undefined,
            note: editingEvaluation?.isSkillNote ? undefined : trimmedNote || undefined,
            skillNotes: editingEvaluation
              ? skills
                .map((skill) => ({
                  skillId: skill.id,
                  skillName: skill.name,
                  note: editingEvaluation.isSkillNote && editingEvaluation.skillId === skill.id
                    ? editingSkillNoteText
                    : (skillNotesBySkillId[skill.id]?.trim() ?? ''),
                }))
                .filter((entry) => entry.note.length > 0)
              : skillNoteEntries,
            skillUpdates: changedSkillUpdates,
            savedAt,
            createdEvaluations,
          });
        }, closeDelayMs);
      }
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : 'Failed to submit evaluation.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {viewOnly && (
        <p className="text-xs text-gray-500">Viewing this evaluation in read-only mode.</p>
      )}

      <div className="space-y-3">
        {skills.map((skill) => {
          const progress = progressBySkillId[skill.id] ?? null;

          return (
            <div
              key={skill.id}
              className="rounded-lg border border-gray-200 bg-white px-3 py-3 shadow-sm sm:px-4"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 leading-snug">{skill.name}</p>
                    {skill.dateAcquired && (
                      <p className="mt-0.5 text-xs text-gray-400">Acquired {skill.dateAcquired}</p>
                    )}
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-xs font-medium text-gray-700">Progress</p>
                  <div className="flex flex-wrap gap-1.5">
                    {PROGRESS_OPTIONS.map((option) => {
                      const isActive = progress === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() =>
                            handleProgressChange(
                              skill.id,
                              isActive ? null : option.value,
                            )
                          }
                          disabled={viewOnly}
                          aria-pressed={isActive}
                          aria-label={`${option.value}: ${PROGRESS_DESCRIPTIONS[option.value]}`}
                          title={isActive
                            ? `${option.value}: ${PROGRESS_DESCRIPTIONS[option.value]} (click to clear)`
                            : `${option.value}: ${PROGRESS_DESCRIPTIONS[option.value]}`}
                          className={`inline-flex cursor-pointer items-center justify-center rounded-full border px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${isActive
                            ? 'border-blue-600 bg-blue-600 text-white shadow-sm hover:bg-blue-700'
                            : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                            }`}
                        >
                          {option.value}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {!viewOnly && (
                  <div>
                    {expandedNoteSkillIds.has(skill.id) || skillNotesBySkillId[skill.id] ? (
                      <>
                        <label className="mb-1 block text-xs font-medium text-gray-700">Skill note</label>
                        <textarea
                          value={skillNotesBySkillId[skill.id] ?? ''}
                          onChange={(event) => {
                            setSkillNotesBySkillId((prev) => ({
                              ...prev,
                              [skill.id]: event.target.value,
                            }));
                            setSuccessMessage('');
                          }}
                          placeholder={`Optional note for ${skill.name}`}
                          rows={2}
                          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setExpandedNoteSkillIds((prev) => new Set([...prev, skill.id]))}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        + Add note
                      </button>
                    )}
                  </div>
                )}

                {viewOnly && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-gray-700">Skill note</label>
                    <textarea
                      value={skillNotesBySkillId[skill.id] ?? ''}
                      onChange={() => {}}
                      placeholder={`Optional note for ${skill.name}`}
                      rows={2}
                      disabled
                      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {skills.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-4 text-sm text-gray-500">
            No organization skills are configured yet.
          </div>
        )}
      </div>

      {!editingEvaluation?.isSkillNote && (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <label className="mb-2 block text-sm font-medium text-gray-900">
          Session note
        </label>
        <textarea
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setSuccessMessage('');
          }}
          placeholder="Optional note about this swimmer's session"
          rows={4}
          disabled={viewOnly}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      )}

      {!viewOnly && (
        <div className="flex items-center justify-end gap-3">
          <p className="text-xs text-gray-500">
            {changedSkillUpdates.length} skill {changedSkillUpdates.length === 1 ? 'change' : 'changes'} ready
          </p>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {isSubmitting ? (
              <>
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Saving...
              </>
            ) : (
              <>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {editingEvaluation ? 'Save Changes' : 'Save Evaluation'}
              </>
            )}
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {successMessage && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {successMessage}
        </div>
      )}
    </form>
  );
}
