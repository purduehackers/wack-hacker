import { z } from "zod";

export const artifactIdSchema = z.string().regex(/^[a-f0-9]{32}$/u);
