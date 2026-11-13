import type { ExamAttempt } from "./types";

interface ExamResultsProps {
  attempt: ExamAttempt;
  onBackToBuilder: () => void;
  onBackToLibrary: () => void;
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes + "m " + remainder + "s";
}

export default function ExamResults({
  attempt,
  onBackToBuilder,
  onBackToLibrary,
}: ExamResultsProps) {
  const positiveScore = attempt.answers.reduce(
    (sum, answer) => sum + Math.max(0, answer.pointsAwarded),
    0,
  );
  const negativeScore = attempt.answers.reduce(
    (sum, answer) => sum + Math.min(0, answer.pointsAwarded),
    0,
  );

  return (
    <section className="page-section exam-results-section">
      <div className="page-heading simple-heading">
        <div>
          <div className="eyebrow">TEST SUBMITTED</div>
          <h1>{attempt.title}</h1>
          <p>Completed {new Date(attempt.createdAt).toLocaleString()} · saved in this browser</p>
        </div>
        <div className="exam-results-actions">
          <button className="button button-outline" onClick={() => window.print()}>Print result</button>
          <button className="button button-primary" onClick={onBackToBuilder}>Build another test</button>
        </div>
      </div>

      <div className="exam-score-hero panel">
        <div className="exam-score-main">
          <span>YOUR SCORE</span>
          <strong>{Number(attempt.score.toFixed(2))}<small> / {Number(attempt.maxScore.toFixed(2))}</small></strong>
          <b>{attempt.percentage.toFixed(2)}%</b>
        </div>
        <div className="exam-score-breakdown">
          <div><span>Positive marks</span><strong>+{positiveScore.toFixed(2)}</strong></div>
          <div><span>Negative marks</span><strong>{negativeScore.toFixed(2)}</strong></div>
          <div><span>Time used</span><strong>{formatDuration(attempt.elapsedSeconds)}</strong></div>
          <div><span>Questions</span><strong>{attempt.questionCount}</strong></div>
        </div>
      </div>

      <div className="exam-result-stats">
        <div><strong>{attempt.correctCount}</strong><span>Correct</span></div>
        <div><strong>{attempt.incorrectCount}</strong><span>Incorrect</span></div>
        <div><strong>{attempt.unansweredCount}</strong><span>Unanswered</span></div>
        <div><strong>{attempt.answeredCount}/{attempt.questionCount}</strong><span>Attempted</span></div>
      </div>

      <div className="panel exam-answer-review">
        <div className="exam-result-list-heading">
          <div><h2>Question-wise result</h2><p>Each response is compared with the verified answer mapping saved for its source paper.</p></div>
          <button className="button button-outline button-small" onClick={onBackToLibrary}>Back to library</button>
        </div>
        {attempt.answers.map((answer, index) => (
          <article className={"exam-result-question " + answer.status} key={answer.questionId}>
            <div className="exam-result-question-top">
              <div><span>Q{index + 1}</span><strong>{answer.subject} · printed Q{answer.questionNumber}</strong><small>{answer.paperTitle}</small></div>
              <div className="exam-result-points">
                <span className={"exam-result-status " + answer.status}>{answer.status}</span>
                <strong>{answer.pointsAwarded > 0 ? "+" : ""}{answer.pointsAwarded.toFixed(2)} / {answer.pointsPossible.toFixed(2)}</strong>
              </div>
            </div>
            <p className="exam-result-question-text">{answer.questionText}</p>
            <div className="exam-result-answer-pair">
              <div><span>Your response</span><strong>{answer.selectedAnswer || "Not answered"}</strong></div>
              <div><span>Verified answer key</span><strong>{answer.correctAnswer}</strong></div>
            </div>
            <small className="exam-result-source">
              Question: {answer.questionSourceFilename} · p.{answer.questionSourcePage}
              {"  "} | {"  "}Key: {answer.answerSourceFilename} · p.{answer.answerSourcePage}
            </small>
          </article>
        ))}
      </div>
      <div className="exam-results-footer">
        <span>Attempt ID: {attempt.id}</span>
        <span>Stored locally in this browser. No response or score was uploaded.</span>
      </div>
    </section>
  );
}
