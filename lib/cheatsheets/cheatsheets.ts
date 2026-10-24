import { z } from "zod";

/**
 * Cheat sheets (spec §52): compact references, versioned and sourced, reviewed like other
 * content (drafts appear only after the opt-in), and hidden while a mock interview runs.
 */

const SHEET_ID = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(60);

export const cheatsheetIndexSchema = z
  .object({
    version: z.literal(1),
    provenance: z.object({ author: z.string().min(1), license: z.string().min(1) }).strict(),
    sheets: z
      .array(
        z
          .object({
            id: SHEET_ID,
            title: z.string().min(1).max(80),
            summary: z.string().min(10).max(200),
            file: z.string().regex(/^[a-z0-9-]+\.md$/),
            version: z.number().int().min(1),
            updated: z.iso.date(),
            review: z.object({ status: z.enum(["draft", "published"]) }).strict(),
            sources: z.array(z.string().min(5).max(200)).min(1).max(5),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
  .superRefine((index, ctx) => {
    const ids = index.sheets.map((sheet) => sheet.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "cheat sheet ids repeat" });
  });

export type CheatsheetIndex = z.infer<typeof cheatsheetIndexSchema>;
export type CheatsheetMeta = CheatsheetIndex["sheets"][number];

export interface Cheatsheet extends CheatsheetMeta {
  readonly body: string;
}
