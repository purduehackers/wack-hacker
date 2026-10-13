import { defineChannel, GET } from "eve/channels";

import { runtime } from "../lib/runtime.ts";
import { viewBadge } from "../lib/viewer.ts";

export default defineChannel({
  routes: [GET("/badges/view", (request) => viewBadge(request, runtime().store))],
});
