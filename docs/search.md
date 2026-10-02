# Search and discovery

Docsup search is a family-scoped PostgreSQL/Prisma query integrated into `/documents`. It does not download Appwrite files, inspect private storage, or create a second document model.

## API

Primary route:

```text
GET /api/search/documents?familyId=...&q=...&profileId=...&categoryId=...&status=...&verificationStatus=...&from=YYYY-MM-DD&to=YYYY-MM-DD&page=1&pageSize=20
```

The existing `/api/search` route accepts the same contract for compatibility. Success responses contain:

```json
{
  "data": {
    "items": [],
    "page": 1,
    "pageSize": 20,
    "total": 0,
    "pages": 0,
    "hasNextPage": false
  }
}
```

Search fields are derived from existing persisted records:

- document title;
- document type;
- original `DocumentVersion.fileName`;
- profile name;
- category name;
- persisted `DocumentMetadata.value` (including extracted values when present);
- document status;
- `verifiedAt` verification state;
- document `createdAt` date range.

`pageSize` is bounded to 50 and the page number is bounded to 10,000. Empty or malformed filters, unsupported statuses, invalid dates, and reversed date ranges return 422. Deleted and deletion-pending documents are never returned.

## Authorization and privacy

Every request requires the existing session. `familyId` is checked against the authenticated user's `FamilyMember` record; an outsider receives the existing family-not-found response. All filters remain constrained by that family predicate, including profile and category filters. A viewer can search only the same family-visible document records that the existing Documents API permits; search does not grant download, approval, deletion, or storage access.

Results return only document metadata needed by the Documents list and existing detail actions. They do not include Appwrite `storageFileId`, object keys, private URLs, session tokens, invitation tokens, or document metadata rows themselves. Searching a persisted document number can find a result, but the number is not echoed in the result or displayed in the list.

Open, download, approve and delete actions continue to use the existing document detail, secure download, approval, and deletion routes. Search never bypasses those checks.

## UI behavior

The Documents workspace includes:

- debounced text search (350ms) with a Search button;
- profile, category, status, verification, start-date and end-date filters;
- clear filters;
- loading, API-error, empty-family, no-results and pagination states;
- the existing secure document detail and action flow.

The UI resets to page one when search criteria change. Search and filter state is family-local because the workspace remounts when the selected family changes.

## Deferred

OCR, AI extraction of new metadata, semantic/vector search, full-text/trigram indexes, and document-number-specific UI are deferred. Existing persisted metadata is searchable now; no new metadata field or Prisma migration was introduced for this phase.

## Verification

- `scripts/test-search.cjs` uses synthetic PostgreSQL metadata and tests authentication, family isolation, viewer access, title/filename/profile/category/status/verification/date/metadata matching, deleted-document exclusion, malformed filters, pagination, private-field omission, and the compatibility route.
- `scripts/test-documents.cjs` runs the real browser flow through search, profile/category filters, clear filters, document detail, approval, secure download, family isolation, Appwrite privacy, and deletion cleanup.
- Tests run against Windows-native PostgreSQL with synthetic records cleaned up after completion.
