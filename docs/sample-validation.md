# Sample PDF observations

These observations are from two user-supplied PDFs used as development references. The PDFs themselves are not committed to this repository.

## JEE Main 2020, 07 January Shift 1 (MathonGo)

- The supplied file has 12 pages.
- Question content appears before the answer key.
- Page 12 contains a prominent ANSWER KEYS heading.
- The key lists question numbers 1 through 75 on that same page.
- Early responses are option numbers; later responses include numeric values such as negative and decimal numbers.

Implementation implications:

- The question-paper PDF itself must be scanned through its final page.
- Do not require a second PDF for the answer key.
- Do not model every answer as A/B/C/D or as an option index. Keep the raw answer value and add typed normalization only after the question type is known.
- Preserve page-level provenance for each extracted answer.

## JEE Advanced 2020 Paper 1 (English)

- The supplied file has 24 pages.
- The question-paper content is arranged in three consecutive subject blocks.
- Printed question numbering restarts at Q.1 at the start of each block.
- The visible page counters restart as 1/11, 1/8, and 1/5 at the starts of the three blocks.
- The file contains question content and ends with END OF THE QUESTION PAPER markers; no answer-key heading or answer-key page was found in the supplied PDF.

Implementation implications:

- The parser must detect page/section boundaries and must not treat question number alone as a unique ID.
- Subject assignment should be suggested from section structure/content, then verified by a reviewer.
- The lack of an embedded key must produce not_detected, not a hard failure. The uploader can add a separate answer-key document later.
- This sample includes option-based questions and numerical-response questions, so question type and answer type must be separate fields.

## Fixture policy

These copyrighted PDFs are not included in the repository. Automated tests use synthetic PDFs generated at test time. Contributors may add only fixtures that are licensed for redistribution.
