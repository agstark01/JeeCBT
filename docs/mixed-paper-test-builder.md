# Mixed-paper test builder and scoring

## Scope

Build one timed practice test from one or more imported paper packages. Every package contains a question paper and its associated embedded or separate answer-key PDFs. The builder is local-only: it reads IndexedDB and never uploads documents, questions, responses or scores.

## Eligibility gate

A question enters a scored test only when all of the following are true:

1. It belongs to a selected PaperPackage and a known question-paper document.
2. Its subject is assigned and its question type is classified.
3. Its extracted text and metadata have been reviewed and marked verified.
4. Exactly one answer mapping in that same package matches the question identity.
5. The answer mapping has source provenance, has been linked or uniquely reconciled to the exact question, and has been marked verified.
6. Its raw answer format is supported by the current scorer.

The mapping identity includes package, target question-paper document, question number and available subject/paper/section/block metadata. When these fields do not uniquely identify one question, the answer-key reviewer requires an explicit question selection. The question number alone is never a global key.

## Review workflow

- Segment the question paper and review the extracted question text, type, subject and visual crop.
- Mark the question verified only after checking it against the original page.
- Open Answer-key review, select the source key PDF and target question paper, inspect the original key page, edit the raw answer if needed, select the exact question, and verify the mapping.
- Changing the answer, source or target reopens the mapping for review.
- A verified answer mapping cannot make an unverified question eligible; both gates are required.

## Test configuration and sampling

The builder supports:

- multiple source packages;
- Physics, Chemistry and Mathematics quotas;
- test duration in minutes;
- shuffle on/off;
- fallback marks for correct and incorrect answers.

For each requested subject, the application counts fully eligible records before launch. If the verified pool is smaller than the quota, the builder reports the exact shortfall and will not silently reduce the test size.

When shuffle is enabled, the test samples without replacement per subject and shuffles the final selected questions. When shuffle is disabled, it preserves the selected package/question source order. Every selected question is snapshotted with its exact answer value and source provenance.

## Answer evaluation

- Single choice: one selected option must match the raw verified option label.
- Multiple correct: the learner's complete option set must exactly match the verified set. Order does not matter.
- Numerical: the response and key are parsed as numbers and compared using a small floating-point tolerance.
- Unanswered: zero marks.
- Question-specific positive and negative marks override the test-level fallback marks. The initial defaults are +4 for correct and -1 for incorrect, and can be changed before the test.

**Important JEE Advanced limitation:** this version does not implement section-specific partial-credit schemes for multiple-correct questions. It uses exact-set scoring for those questions. The displayed score is only an official-style score when the source paper's marking rules are compatible with that scoring behavior and the configured fallback marks.

Units, numerical acceptance ranges, symbolic equivalence, matrix-match, integer-grid and other exam-specific answer formats are not supported yet. Keys using unsupported answer formats are excluded from the eligible pool instead of being silently marked wrong.

## Timer, results and storage

The runner provides a countdown, question palette, previous/next navigation, mark-for-review, clear response, manual submission and auto-submission at zero. The clock is browser-local and is not tamper-proof.

On submission, the result screen displays total score, percentage, positive/negative marks, correct/incorrect/unanswered counts, and a question-wise comparison against the exact verified mapping. The submitted attempt is stored in IndexedDB with its answer snapshot and score.

In-progress answers are currently kept in React memory and are not persisted until submission. Reloading or closing the page before submitting loses that attempt. Mid-test autosave and reload recovery are future work.

No exam content or scores are committed to GitHub.
