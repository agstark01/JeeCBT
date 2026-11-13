import { useEffect, useMemo, useRef, useState } from "react";
import QuestionCapture from "./QuestionCapture";
import { createExamAttempt, type ScoringDefaults } from "./lib/scoring";
import { getQuestionOptionLabels, isSupportedAnswerFormat } from "./lib/scoring";
import type { ExamAttempt } from "./types";
import type { EligibleTestQuestion } from "./lib/test-builder";

interface ExamRunnerProps {
  ownerId: string;
  title: string;
  questions: EligibleTestQuestion[];
  durationMinutes: number;
  defaults: ScoringDefaults;
  onComplete: (attempt: ExamAttempt) => Promise<void>;
  onCancel: () => void;
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return minutes + ":" + remainder;
}

export default function ExamRunner({
  ownerId,
  title,
  questions,
  durationMinutes,
  defaults,
  onComplete,
  onCancel,
}: ExamRunnerProps) {
  const durationSeconds = durationMinutes * 60;
  const startedAt = useRef(Date.now());
  const answersRef = useRef<Record<string, string>>({});
  const submittedRef = useRef(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [markedForReview, setMarkedForReview] = useState<Record<string, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState(durationSeconds);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const current = questions[currentIndex];
  const labels = useMemo(
    () => current ? getQuestionOptionLabels(current.question) : [],
    [current],
  );

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const finish = async (timeExpired = false) => {
    if (submittedRef.current || submitting) return;
    submittedRef.current = true;
    setSubmitting(true);
    setSubmitError("");
    const elapsedSeconds = Math.min(
      durationSeconds,
      Math.max(0, Math.floor((Date.now() - startedAt.current) / 1000)),
    );
    const attempt = createExamAttempt({
      ownerId,
      title,
      packageIds: questions.map((item) => item.packageId),
      questions,
      answers: answersRef.current,
      durationSeconds,
      elapsedSeconds,
      defaults,
    });
    try {
      await onComplete(attempt);
    } catch (caught) {
      submittedRef.current = false;
      setSubmitError(caught instanceof Error ? caught.message : "The result could not be saved locally.");
      setSubmitting(false);
      return;
    }
    if (timeExpired) setSecondsRemaining(0);
  };

  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });

  useEffect(() => {
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt.current) / 1000);
      const remaining = Math.max(0, durationSeconds - elapsed);
      setSecondsRemaining(remaining);
      if (remaining === 0) void finishRef.current(true);
    }, 250);
    return () => window.clearInterval(timer);
  }, [durationSeconds]);

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((currentAnswers) => {
      const next = { ...currentAnswers, [questionId]: value };
      answersRef.current = next;
      return next;
    });
  };

  const toggleOption = (questionId: string, option: string) => {
    const selected = new Set(
      (answersRef.current[questionId] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    if (selected.has(option)) selected.delete(option);
    else selected.add(option);
    setAnswer(questionId, [...selected].sort().join(","));
  };

  if (!current) {
    return <section className="page-section"><div className="panel exam-empty">No eligible questions were selected.</div></section>;
  }

  const answeredCount = questions.filter((item) => Boolean(answers[item.question.id]?.trim())).length;
  const markedCount = Object.values(markedForReview).filter(Boolean).length;
  const selectedForCurrent = new Set(
    (answers[current.question.id] ?? "").split(",").map((value) => value.trim()).filter(Boolean),
  );
  const typeLabel = current.question.questionType === "multiple_choice"
    ? "Multiple correct"
    : current.question.questionType === "numerical"
      ? "Numerical answer"
      : "Single correct";

  return (
    <section className="page-section exam-section">
      <div className="exam-topline">
        <div>
          <div className="eyebrow">TIMED PRACTICE TEST</div>
          <h1>{title}</h1>
          <p>{questions.length} questions · Local browser timer · No server submission</p>
          <button className="text-button" onClick={onCancel}>Exit to test builder</button>
        </div>
        <div className={secondsRemaining <= 300 ? "exam-clock urgent" : "exam-clock"}>
          <span>TIME LEFT</span>
          <strong>{formatClock(secondsRemaining)}</strong>
        </div>
      </div>

      <div className="exam-progress">
        <div><span>Answered</span><strong>{answeredCount}/{questions.length}</strong></div>
        <div><span>Marked for review</span><strong>{markedCount}</strong></div>
        <div className="exam-progress-track"><span style={{ width: (answeredCount / questions.length * 100) + "%" }} /></div>
      </div>

      <div className="exam-layout">
        <aside className="panel exam-navigation">
          <div className="exam-nav-heading"><strong>Question palette</strong><small>Green: answered · Amber: review</small></div>
          <div className="exam-question-grid">
            {questions.map((item, index) => {
              const id = item.question.id;
              const state = answers[id]?.trim() ? "answered" : markedForReview[id] ? "marked" : "unanswered";
              return (
                <button
                  type="button"
                  className={"exam-question-jump " + state + (index === currentIndex ? " active" : "")}
                  key={id}
                  onClick={() => setCurrentIndex(index)}
                  aria-label={"Go to question " + (index + 1) + ", " + state}
                >
                  {index + 1}
                </button>
              );
            })}
          </div>
          <div className="exam-legend">
            <span><i className="answered" /> Answered</span>
            <span><i className="marked" /> Marked</span>
            <span><i className="unanswered" /> Not answered</span>
          </div>
        </aside>

        <div className="exam-workspace">
          <article className="panel exam-question-card">
            <div className="exam-question-heading">
              <div>
                <span>QUESTION {currentIndex + 1} OF {questions.length}</span>
                <h2>Q{current.question.questionNumber} · {current.question.subject}</h2>
                <small>{typeLabel} · {current.packageTitle} · {current.question.sourceFilename} p.{current.question.sourcePageStart}</small>
              </div>
              <button
                className={markedForReview[current.question.id] ? "button button-marked button-small" : "button button-outline button-small"}
                onClick={() => setMarkedForReview((currentMarks) => ({
                  ...currentMarks,
                  [current.question.id]: !currentMarks[current.question.id],
                }))}
              >
                {markedForReview[current.question.id] ? "Marked for review" : "Mark for review"}
              </button>
            </div>

            <div className="exam-question-text">{current.question.statementText}</div>
            <div className="exam-source-visual">
              <QuestionCapture
                document={current.sourceDocument}
                regions={current.question.sourceRegions ?? []}
                optionRegions={current.question.optionRegions ?? []}
                questionNumber={current.question.questionNumber}
              />
            </div>

            {current.question.questionType === "numerical" ? (
              <label className="exam-numerical-answer">
                Your numerical answer
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="Enter a number, e.g. -2.7 or 25.6"
                  value={answers[current.question.id] ?? ""}
                  onChange={(event) => setAnswer(current.question.id, event.target.value)}
                />
              </label>
            ) : (
              <div className="exam-options">
                <div className="exam-options-heading">
                  {current.question.questionType === "multiple_choice" ? "Select every correct option" : "Select one option"}
                </div>
                {labels.map((label) => (
                  <button
                    type="button"
                    key={label}
                    className={selectedForCurrent.has(label) ? "exam-option selected" : "exam-option"}
                    onClick={() => {
                      if (current.question.questionType === "multiple_choice") {
                        toggleOption(current.question.id, label);
                      } else {
                        setAnswer(current.question.id, label);
                      }
                    }}
                  >
                    <span>{label}</span>
                    <strong>{selectedForCurrent.has(label) ? "Selected" : "Choose"}</strong>
                  </button>
                ))}
                {!isSupportedAnswerFormat(current.question, current.correctAnswerRaw) && (
                  <div className="warning-line">This answer key uses a format the current scorer cannot validate. Do not submit this question for scoring; fix its raw key value in answer review.</div>
                )}
              </div>
            )}

            <div className="exam-question-actions">
              <button className="button button-outline" onClick={() => setAnswer(current.question.id, "")}>Clear response</button>
              <div>
                <button className="button button-outline" onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))} disabled={currentIndex === 0}>Previous</button>
                <button className="button button-primary" onClick={() => setCurrentIndex((index) => Math.min(questions.length - 1, index + 1))} disabled={currentIndex === questions.length - 1}>Next question</button>
              </div>
            </div>
          </article>
          <div className="exam-submit-row">
            {submitError && <div className="message message-error">{submitError}</div>}
            <span>{answeredCount} answered · {questions.length - answeredCount} unanswered</span>
            <button className="button button-primary" onClick={() => setShowSubmitConfirm(true)} disabled={submitting}>
              {submitting ? "Saving result…" : "Submit test"}
            </button>
          </div>
          <small className="exam-scoring-note">
            Scoring: question-specific marks are used when detected. Otherwise this test uses {defaults.correctMarks >= 0 ? "+" : ""}{defaults.correctMarks} for correct and {defaults.incorrectMarks} for incorrect; unanswered = 0. Multiple-correct questions require the complete option set. This is a practice timer, not a proctored exam.
          </small>
        </div>
      </div>

      {showSubmitConfirm && (
        <div className="exam-confirm-backdrop" role="presentation">
          <div className="panel exam-confirm" role="dialog" aria-modal="true" aria-labelledby="submit-test-title">
            <h2 id="submit-test-title">Submit this test?</h2>
            <p>{answeredCount} answered, {questions.length - answeredCount} unanswered, {markedCount} marked for review.</p>
            <div><button className="button button-outline" onClick={() => setShowSubmitConfirm(false)}>Continue test</button><button className="button button-primary" onClick={() => void finish(false)} disabled={submitting}>Submit and calculate score</button></div>
          </div>
        </div>
      )}
    </section>
  );
}
