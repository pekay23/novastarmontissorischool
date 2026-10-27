import { z } from "zod";

const namedOption = z.object({ id: z.string(), name: z.string() });
export const timetableOptionsSchema = z.object({
  options: z.object({
    classes: z.array(namedOption),
    terms: z.array(namedOption),
    classSubjects: z.array(
      z.object({ id: z.string(), classId: z.string(), name: z.string() }),
    ),
    canUpdate: z.boolean(),
  }),
});
export const timetableSchema = z.object({
  id: z.string(),
  name: z.string(),
  isPublished: z.boolean(),
  classId: z.string(),
  termId: z.string(),
  class: namedOption.nullable(),
  term: namedOption.nullable(),
  entries: z.array(
    z.object({
      id: z.string(),
      classSubjectId: z.string(),
      dayOfWeek: z.number(),
      startTime: z.string(),
      endTime: z.string(),
      room: z.string().nullable(),
      classSubject: z
        .object({
          subject: z.object({ name: z.string(), code: z.string() }).nullable(),
          teacher: z
            .object({ firstName: z.string(), lastName: z.string() })
            .nullable(),
        })
        .nullable(),
    }),
  ),
});
export type TimetableDetail = z.infer<typeof timetableSchema>;
export type TimetableOptions = z.infer<
  typeof timetableOptionsSchema
>["options"];
