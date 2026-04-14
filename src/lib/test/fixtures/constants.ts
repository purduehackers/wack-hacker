import type { SkillBundle } from "@/lib/ai/skills/types";

import { UserRole } from "@/lib/ai/constants";

export const TEST_SKILLS: Record<string, SkillBundle> = {
  scheduling: {
    name: "scheduling",
    description: "Schedule tasks",
    criteria: "When user wants to schedule",
    toolNames: ["scheduleTask", "cancelTask"],
    minRole: UserRole.Public,
    mode: "inline",
    instructions: "Use cron expressions.",
  },
  linear: {
    name: "linear",
    description: "Manage Linear issues",
    criteria: "When user asks about issues",
    toolNames: ["searchIssues", "createIssue"],
    minRole: UserRole.Organizer,
    mode: "delegate",
    instructions: "You are a Linear agent.",
  },
  admin_tools: {
    name: "admin_tools",
    description: "Server admin tools",
    criteria: "When user needs admin actions",
    toolNames: ["banUser"],
    minRole: UserRole.Admin,
    mode: "inline",
    instructions: "Be careful with admin actions.",
  },
};
