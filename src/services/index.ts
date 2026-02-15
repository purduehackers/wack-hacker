import { Layer } from "effect";

import { AI } from "./AI";
import { Dashboard } from "./Dashboard";
import { Database } from "./Database";
import { Discord } from "./Discord";
import { FeatureFlags } from "./FeatureFlags";
import { GitHub } from "./GitHub";
import { MediaWiki } from "./MediaWiki";
import { MeetingNotes } from "./MeetingNotes";
import { Notion } from "./Notion";
import { Phonebell } from "./Phonebell";
import { Storage } from "./Storage";

export const ServicesLive = Layer.mergeAll(
    Database.Default,
    AI.Default,
    Storage.Default,
    GitHub.Default,
    MediaWiki.Default,
    Phonebell.Default,
    Notion.Default,
    MeetingNotes.Default,
    Dashboard.Default,
    Discord.Default,
    FeatureFlags.Default,
);

export { Database, Database as DatabaseLive } from "./Database";
export { AI, AI as AILive } from "./AI";
export { Storage, Storage as StorageLive, type ImageMetadata, type EventIndex } from "./Storage";
export { GitHub, GitHub as GitHubLive } from "./GitHub";
export { MediaWiki, MediaWiki as MediaWikiLive } from "./MediaWiki";
export { Phonebell, Phonebell as PhonebellLive } from "./Phonebell";
export { Notion, Notion as NotionLive } from "./Notion";
export { MeetingNotes, MeetingNotes as MeetingNotesLive } from "./MeetingNotes";
export { Dashboard, Dashboard as DashboardLive, type DiscordMessage } from "./Dashboard";
export { Discord, Discord as DiscordLive } from "./Discord";
export { FeatureFlags, type Flags } from "./FeatureFlags";
