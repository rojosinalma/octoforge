import { z } from 'zod';

/** One entry of `members.json`: a tool of the family. */
export const MembersFileEntry = z
  .object({
    name: z
      .string()
      .regex(
        /^[a-z0-9][a-z0-9-]*$/,
        'lower-case letters, digits and dashes, starting with a letter or digit',
      ),
    repo: z.string().regex(/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/, 'must be owner/name on GitHub'),
    homepage: z
      .string()
      .url()
      .regex(/^https?:\/\//, 'must be an http(s) URL')
      .optional(),
  })
  .strict();
export type MembersFileEntry = z.infer<typeof MembersFileEntry>;

/** `members.json` at the repository root: the member list. Names are unique. */
export const MembersFile = z
  .object({ members: z.array(MembersFileEntry) })
  .strict()
  .superRefine((f, ctx) => {
    const seen = new Set<string>();
    f.members.forEach((m, i) => {
      if (seen.has(m.name))
        ctx.addIssue({ code: 'custom', path: ['members', i, 'name'], message: `duplicate name ${m.name}` });
      seen.add(m.name);
    });
  });
export type MembersFile = z.infer<typeof MembersFile>;

/** Parses the file text; the error names the first problems with their paths. */
export function parseMembersFile(
  text: string,
): { ok: true; members: MembersFileEntry[] } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `not JSON: ${err instanceof Error ? err.message : String(err)}` };
  }
  const r = MembersFile.safeParse(raw);
  if (!r.success)
    return {
      ok: false,
      error: r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    };
  return { ok: true, members: r.data.members };
}
