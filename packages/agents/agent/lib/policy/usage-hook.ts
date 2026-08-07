import { getBudgetStore } from "./stores.ts";
import { defineUsageHook } from "./usage.ts";

export default defineUsageHook(getBudgetStore());
