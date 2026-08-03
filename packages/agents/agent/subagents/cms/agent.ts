import { defineAgent } from "eve";

export default defineAgent({
  description:
    "Manage Purdue Hackers website content in Payload CMS at cms.purduehackers.com — events, " +
    "RSVPs, email blasts, hack night sessions, microgrant and shelter showcases, the media " +
    "library, CMS users, and service accounts. Use when: the user asks about events on " +
    "purduehackers.com, RSVPs, email blasts, hack night sessions, microgrants (ugrants), shelter " +
    "wall projects, media assets on the CMS, CMS users, or service accounts.",
  model: "anthropic/claude-sonnet-5",
});
