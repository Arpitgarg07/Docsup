import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";

export const searchableStatuses = ["PROCESSING", "UPLOADED", "PENDING_APPROVAL", "APPROVED", "VERIFIED", "REJECTED", "ARCHIVED"] as const;
const optionalQuery = z.preprocess(value => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().trim().min(2).max(120).optional());
const optionalId = z.string().trim().min(1).max(64).optional();
const optionalDate = z.string().date().optional();

export const documentSearchSchema = z.object({
  familyId: z.string().trim().min(1).max(64),
  q: optionalQuery,
  profileId: optionalId,
  categoryId: optionalId,
  status: z.enum(searchableStatuses).optional(),
  verificationStatus: z.enum(["VERIFIED", "UNVERIFIED"]).optional(),
  from: optionalDate,
  to: optionalDate,
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).superRefine((value, context) => {
  if (value.from && value.to && value.from > value.to) context.addIssue({ code: "custom", path: ["to"], message: "The end date must not be before the start date" });
});

export type DocumentSearchInput = z.infer<typeof documentSearchSchema>;

export function parseDocumentSearch(request: Request) {
  return documentSearchSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
}

function dayStart(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}
function dayAfter(value: string) {
  const date = dayStart(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export function documentSearchWhere(input: DocumentSearchInput): Prisma.DocumentWhereInput {
  const where: Prisma.DocumentWhereInput = {
    familyId: input.familyId,
    status: input.status ?? { notIn: ["DRAFT", "UPLOADING", "DELETED", "DELETION_PENDING"] },
    ...(input.profileId ? { profileId: input.profileId } : {}),
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
  };
  if (input.verificationStatus) where.verifiedAt = input.verificationStatus === "VERIFIED" ? { not: null } : null;
  if (input.from || input.to) where.createdAt = { ...(input.from ? { gte: dayStart(input.from) } : {}), ...(input.to ? { lt: dayAfter(input.to) } : {}) };
  if (input.q) {
    where.OR = [
      { title: { contains: input.q, mode: "insensitive" } },
      { documentType: { contains: input.q, mode: "insensitive" } },
      { profile: { name: { contains: input.q, mode: "insensitive" } } },
      { category: { name: { contains: input.q, mode: "insensitive" } } },
      { versions: { some: { kind: "ORIGINAL", fileName: { contains: input.q, mode: "insensitive" } } } },
      { metadata: { some: { value: { contains: input.q, mode: "insensitive" } } } },
    ];
  }
  return where;
}

const resultSelect = {
  id: true,
  familyId: true,
  title: true,
  documentType: true,
  status: true,
  sensitive: true,
  createdAt: true,
  updatedAt: true,
  verifiedAt: true,
  profile: { select: { name: true } },
  category: { select: { name: true } },
  versions: { where: { kind: "ORIGINAL" }, select: { id: true, kind: true, fileName: true, mimeType: true, byteSize: true, createdAt: true }, orderBy: { createdAt: "desc" as const }, take: 1 },
} satisfies Prisma.DocumentSelect;

export async function searchDocuments(input: DocumentSearchInput) {
  const where = documentSearchWhere(input);
  const [items, total] = await Promise.all([
    db.document.findMany({ where, select: resultSelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    db.document.count({ where }),
  ]);
  return {
    items: items.map(item => ({ ...item, versions: item.versions.map(version => ({ ...version, byteSize: Number(version.byteSize) })) })),
    page: input.page,
    pageSize: input.pageSize,
    total,
    pages: Math.ceil(total / input.pageSize),
    hasNextPage: input.page * input.pageSize < total,
  };
}
