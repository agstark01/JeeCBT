# Mixed-paper test builder

## Goal

Allow a student to build one timed practice test from multiple imported paper packages. The student selects the source papers, chooses a question quota per subject, sets the duration, and optionally enables random selection and ordering.

The builder is local-only. It reads the selected packages from IndexedDB and does not upload paper content or test data.

## Source and answer-key association

An imported `PaperPackage` is the source boundary: it contains one paper import and the PDFs supplied with that import. Those PDFs may include the question paper, an answer key embedded in the paper, or separately supplied answer-key and solution documents.

When several packages are selected, each question must retain its source package identity. Its answer must be resolved only against answer-key candidates belonging to that same package. A question number alone is never a globally unique key.

The future question identity should include at least:

- source `paperPackageId`;
- paper label / paper number;
- subject;
- section identifier where present;
- question number.

The question record must also retain source document and page provenance. Its answer-key reference should identify the exact candidate and mapping that supplied the answer. Existing extracted mappings are proposals, not verified answers.

This prevents collisions such as Physics Q1 in Paper 1 being matched to Physics Q1 in Paper 2, or a key from a different shift being applied because the question numbers happen to match.

## Test configuration

The current builder UI supports:

- multiple source packages selected together;
- Physics, Chemistry, and Mathematics selection;
- an exact question quota for each selected subject;
- a duration in minutes;
- a shuffle toggle, enabled by default;
- a live total calculated from the active subject quotas.

The total requested question count is the sum of the selected subject quotas. Unselected subjects contribute zero.

## Random selection contract

Once the verified question bank exists, the selection algorithm must:

1. Filter records to the selected package IDs and selected subjects.
2. Include only complete, reviewed question records. For scored tests, the matching answer mapping must also be verified and belong to the same source package.
3. Check the available pool for each subject before constructing the test. If a subject has fewer eligible questions than requested, show the shortfall and do not silently reduce the quota.
4. When shuffle is enabled, sample each subject pool uniformly without replacement, then randomize the order of the selected questions. No question may appear twice in one test.
5. When shuffle is disabled, use a stable source order (paper import order, paper/section order, then question number).
6. Preserve each question's source and answer-key reference in the test snapshot so evaluation uses the exact mapping associated with that question.

The utility `sampleWithoutReplacement` is implemented and unit-tested as a reusable foundation. It is not connected to live question records yet because question segmentation and review are not implemented.

## Current limitation

The application currently extracts PDF text and proposes answer-key mappings. It does not yet segment complete question statements, options, diagrams, equations, and section instructions into verified question records.

For that reason, the new builder is a configuration preview only. The Start examination action remains disabled. It must not treat answer-key rows as questions, infer question availability from the number of answer mappings, or score against unverified candidates.

The next prerequisite is question segmentation plus a review workflow that creates verified question records and links each one to the correct package-specific answer mapping. After that, the builder can calculate eligible pool counts and launch the mixed-paper exam.
