# Security Spec

## Data Invariants
- A history item cannot exist without a valid userId that belongs to the user.
- A user can only read, update, and delete their own history.
- The items array is bounded and its elements are strings.

## Dirty Dozen Payloads
1. Unauthorized create
2. Malformed ID create
3. Incorrect userId on create
4. Missing required keys on create
5. Shadow field injection on create
6. Type violation on targetLanguage
7. Array size violation on items
8. Update unauthorized field (userId)
9. Read other user's history
10. Update other user's history
11. PII exposure
12. Terminal state violation (not applicable)

## The Test Runner
To be implemented in `firestore.rules.test.ts`.
