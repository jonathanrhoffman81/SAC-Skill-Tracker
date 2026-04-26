"use client";

import { useEffect, useMemo, useState } from 'react';
import { authFetch } from "@/lib/clientAuth";

interface SkillItem {
  id: string;
  name: string;
  progress: 0 | 1 | 2 | 3 | 4;
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
}

type ToastMessage = {
  id: number;
  message: string;
  type: 'success' | 'error';
};

const PROGRESS_OPTIONS: Array<{ value: 0 | 1 | 2 | 3 | 4; label: string }> = [
  { value: 0, label: '0 - Not started' },
  { value: 1, label: '1 - Beginning' },
  { value: 2, label: '2 - Developing' },
  { value: 3, label: '3 - Nearly there' },
  { value: 4, label: '4 - Acquired' },
];

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
}: EvaluationFormProps) {
  const [progressBySkillId, setProgressBySkillId] = useState<Record<string, SkillItem['progress']>>({});
  const [initialProgressBySkillId, setInitialProgressBySkillId] = useState<Record<string, SkillItem['progress']>>({});
  const [skillNotesBySkillId, setSkillNotesBySkillId] = useState<Record<string, string>>({});
  const [expandedNoteSkillIds, setExpandedNoteSkillIds] = useState<Set<string>>(new Set());
  const [selectedClassId, setSelectedClassId] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = (message: string, type: 'success' | 'error' = 'error') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 6000);
  };

  useEffect(() => {
    const nextProgress = Object.fromEntries(
      skills.map((skill) => [skill.id, skill.progress])
    ) as Record<string, SkillItem['progress']>;

    setProgressBySkillId(nextProgress);
    setInitialProgressBySkillId(nextProgress);
    setSkillNotesBySkillId({});
  }, [skills]);

  useEffect(() => {
    if (!editingEvaluation) {
      setNote('');
      setSkillNotesBySkillId({});
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
  }, [editingEvaluation]);

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
          progress: progressBySkillId[skill.id] ?? 0,
          initialProgress: initialProgressBySkillId[skill.id] ?? 0,
        }))
        .filter((skill) => skill.progress !== skill.initialProgress)
        .map((skill) => ({
          skillId: skill.skillId,
          progress: skill.progress,
        })),
    [initialProgressBySkillId, progressBySkillId, skills]
  );

  const handleProgressChange = (skillId: string, progress: SkillItem['progress']) => {
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

    if (changedSkillUpdates.length === 0 && !trimmedNote && skillNoteEntries.length === 0 && !hasEditingFeedback) {
      const message = 'Update at least one skill or add notes before submitting.';
      setError(message);
      showToast(message, 'error');
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
        skills.map((skill) => [skill.id, progressBySkillId[skill.id] ?? 0])
      ) as Record<string, SkillItem['progress']>;

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
      showToast(message, 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="fixed top-24 right-4 z-[100] space-y-2 w-[92vw] max-w-sm pointer-events-none sm:top-28">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto max-h-56 overflow-y-auto rounded-lg border px-3 py-2 text-sm leading-relaxed shadow-lg break-words whitespace-pre-wrap sm:text-sm ${
              toast.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {viewOnly && (
        <p className="text-xs text-gray-500">Viewing this evaluation in read-only mode.</p>
      )}

      <div className="space-y-3">
        {skills.map((skill) => {
          const progress = progressBySkillId[skill.id] ?? 0;

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
                        <label
                          key={option.value}
                          className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${isActive
                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                            : 'border-gray-300 bg-white text-gray-600 hover:border-gray-400'
                            }`}
                        >
                          <input
                            type="radio"
                            name={`progress-${skill.id}`}
                            value={option.value}
                            checked={isActive}
                            onChange={() => handleProgressChange(skill.id, option.value)}
                            disabled={viewOnly}
                            className="h-3 w-3 accent-blue-600"
                          />
                          <span>{option.value}</span>
                        </label>
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
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
          >
            {isSubmitting ? 'Saving...' : editingEvaluation ? 'Save Changes' : 'Save Evaluation'}
          </button>
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
