"use client";

import { useEffect, useMemo, useState } from 'react';

interface SkillItem {
  id: string;
  name: string;
  progress: 0 | 25 | 50 | 75 | 100;
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
  userEmail: string;
  skills: SkillItem[];
  classes: ClassItem[];
  onSubmissionComplete?: () => void;
}

const PROGRESS_OPTIONS: Array<{ value: 0 | 25 | 50 | 75 | 100; label: string }> = [
  { value: 0, label: '0% - Not started' },
  { value: 25, label: '25% - Beginning' },
  { value: 50, label: '50% - Developing' },
  { value: 75, label: '75% - Nearly there' },
  { value: 100, label: '100% - Acquired' },
];

export default function EvaluationForm({
  swimmerId,
  userEmail,
  skills,
  classes,
  onSubmissionComplete,
}: EvaluationFormProps) {
  const [progressBySkillId, setProgressBySkillId] = useState<Record<string, SkillItem['progress']>>({});
  const [initialProgressBySkillId, setInitialProgressBySkillId] = useState<Record<string, SkillItem['progress']>>({});
  const [skillNotesBySkillId, setSkillNotesBySkillId] = useState<Record<string, string>>({});
  const [selectedClassId, setSelectedClassId] = useState('');
  const [note, setNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    const nextProgress = Object.fromEntries(
      skills.map((skill) => [skill.id, skill.progress])
    ) as Record<string, SkillItem['progress']>;

    setProgressBySkillId(nextProgress);
    setInitialProgressBySkillId(nextProgress);
    setSkillNotesBySkillId({});
  }, [skills]);

  useEffect(() => {
    setSelectedClassId((current) => {
      if (current && classes.some((classItem) => classItem.id === current)) {
        return current;
      }
      return classes[0]?.id ?? '';
    });
  }, [classes]);

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

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedNote = note.trim();
    if (changedSkillUpdates.length === 0 && !trimmedNote && skillNoteEntries.length === 0) {
      setError('Update at least one skill or add notes before submitting.');
      return;
    }

    if (!userEmail) {
      setError('Missing instructor session. Please log in again.');
      return;
    }

    setIsSubmitting(true);
    setError('');
    setSuccessMessage('');

    try {
      const response = await fetch(`/api/instructor/swimmers/${swimmerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          classId: selectedClassId || undefined,
          note: trimmedNote || undefined,
          skillNotes: skillNoteEntries.map((entry) => ({
            skillId: entry.skillId,
            note: entry.note,
          })),
          skillUpdates: changedSkillUpdates,
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to submit evaluation.');
      }

      const nextProgress = Object.fromEntries(
        skills.map((skill) => [skill.id, progressBySkillId[skill.id] ?? 0])
      ) as Record<string, SkillItem['progress']>;

      setInitialProgressBySkillId(nextProgress);
      setSkillNotesBySkillId({});
      setNote('');
      setSuccessMessage('Evaluation saved.');
      onSubmissionComplete?.();
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : 'Failed to submit evaluation.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-gray-200 bg-gray-50 p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">Skill Evaluation</h3>
          <p className="text-xs text-gray-500">
            All organization skills are shown below. Save only the changes you made.
          </p>
        </div>

        {classes.length > 0 && (
          <div className="w-full sm:w-72">
            <label className="mb-1 block text-xs font-medium text-gray-700">
              Class context for note
            </label>
            <select
              value={selectedClassId}
              onChange={(event) => setSelectedClassId(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {classes.map((classItem) => (
                <option key={classItem.id} value={classItem.id}>
                  {classItem.name} - {classItem.schedule}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

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

      <div className="space-y-3">
        {skills.map((skill) => {
          const progress = progressBySkillId[skill.id] ?? 0;

          return (
            <div
              key={skill.id}
              className="rounded-lg border border-gray-200 bg-white px-3 py-3 shadow-sm sm:px-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{skill.name}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500">
                    <span
                      className={`rounded-full px-2 py-0.5 ${
                        progress === 100
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {progress}% progress
                    </span>
                    {skill.dateAcquired && (
                      <span>Acquired on {skill.dateAcquired}</span>
                    )}
                  </div>
                </div>

                <div className="w-full sm:w-60">
                  <label className="mb-1 block text-xs font-medium text-gray-700">
                    Progress
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PROGRESS_OPTIONS.map((option) => {
                      const isActive = progress === option.value;

                      return (
                        <label
                          key={option.value}
                          className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                            isActive
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
                            className="h-3.5 w-3.5 accent-blue-600"
                          />
                          <span>{option.value}%</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-gray-700">
                  Skill note
                </label>
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
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex items-center justify-end gap-3">
        <p className="text-xs text-gray-500">
          {changedSkillUpdates.length} skill {changedSkillUpdates.length === 1 ? 'change' : 'changes'} ready
        </p>
        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
        >
          {isSubmitting ? 'Saving...' : 'Save Evaluation'}
        </button>
      </div>
    </form>
  );
}
