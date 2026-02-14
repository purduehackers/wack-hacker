export const CHECKPOINTS_CHANNEL_ID = "1052236377338683514";
export const LOUNGE_CHANNEL_ID = "809628073896443904";
export const HACK_NIGHT_CHANNEL_ID = "1020777328172859412";
export const SHIP_CHANNEL_ID = "904896819165814794";
export const INTRO_CHANNEL_ID = "1182158612454449282";
export const CORE_COMMUNITY_CHANNEL_ID = "938671895430180865";
export const COMMIT_OVERFLOW_FORUM_ID = "1452388241796894941";
export const COMMIT_OVERFLOW_FORWARD_THREAD_ID = "1453962496170786970";
export const SIGHORSE_CATEGORY_ID = "1381412394676518932";

export const ORGANIZER_ROLE_ID = "1012751663322382438";
export const BISHOP_ROLE_ID = "1199891815780847647";
export const HACK_NIGHT_PHOTOGRAPHY_AWARD_ROLE_ID = "1340775295233560606";
export const WACKY_ROLE_ID = "1419119560627458129";
export const COMMIT_OVERFLOW_ROLE_ID = "1452415675975864515";
export const WELCOMERS_ROLE_ID = "1381409977775947838";
export const HACK_NIGHT_PING_ROLE_ID = "1348025087894355979";

export const ADMINS = ["636701123620634653"] as const;

export const EVERGREEN_CREATE_ISSUE_STRING = "evergreen it";
export const EVERGREEN_WIKI_USER = "CinnamonF80@Wack_Hacker";
export const EVERGREEN_WIKI_URL = "https://evergreen.skywiki.org";
export const EVERGREEN_WIKI_ENDPOINT = "/api.php";
export const EVERGREEN_WIKI_BUFFER = "Evergreen It";

export const COMMIT_OVERFLOW_YEAR = "2025";
export const COMMIT_PIN_EMOJI = "\u{1F4CC}";
export const COMMIT_APPROVE_EMOJI = "\u{1F7E9}";
export const ALTERNATE_COMMIT_APPROVE_EMOJI = "1054579874616066068";
export const COMMIT_PENDING_EMOJI = "\u{1F50D}";
export const COMMIT_EDIT_DESCRIPTION_EMOJI = "\u{270F}\u{FE0F}";
export const COMMIT_PRIVATE_EMOJI = "\u{1F92B}";

export const COMMIT_OVERFLOW_DEFAULT_TIMEZONE = "America/Indiana/Indianapolis";
export const COMMIT_OVERFLOW_DAY_RESET_HOUR = 6;

export const INTERNAL_CATEGORIES = [
    "809620177347411998",
    "1290013838955249734",
    "1082077318329143336",
    "938975633885782037",
] as const;

export const AUTO_THREAD_CHANNELS = [SHIP_CHANNEL_ID, CHECKPOINTS_CHANNEL_ID] as const;

export const CHECKPOINT_RESPONSE_MESSAGES = [
    "Great checkpoint! :D",
    "Nice progress! :D",
    "Awesome update! :D",
    "Yay thanks for sharing! :D",
    "Yippie!! Keep it up! :D",
    "Who up checking they point?",
] as const;

export const SHIP_RESPONSE_MESSAGES = [
    "Congrats on shipping! :D",
    "You shipped it! :D",
    "That's a wrap! :D",
    "Yay thanks for sharing! :D",
    "Yippie!! Great work! :D",
    "Launched and loved! :D",
    "Woohoo, it's live now! :D",
    "Done and dusted! :D",
    "High-five on the ship! :D",
    "Boom, nice ship! :D",
] as const;

export const HACK_NIGHT_MESSAGES = [
    "Happy Hack Night! :D",
    "Welcome to Hack Night! :D",
    "Hack Night is here! :D",
    "It's Hack Night! :D",
    "Hack Night is starting! :D",
    "Let's get hacking! :D",
    "Time to hack! :D",
    "Hack Night is live! :D",
    "Hack Night is a go! :D",
] as const;

export const MEETING_NOTES_DATABASE_ID = "";
export const MEETING_NOTES_DEFAULT_DIRECTORY = "meeting-notes";
export const MEETING_TRANSCRIPT_THREAD_AUTO_ARCHIVE_DURATION = 1440;

export const MEETING_MAX_DISCORD_MESSAGE_LENGTH = 2_000;
export const MEETING_LIVE_TRANSCRIPT_PREFIX = "[live] ";
export const MEETING_LIVE_UPDATE_INTERVAL_MS = 400;

export const MEETING_RECORDINGS_DIRECTORY = "recordings";
export const MEETING_RECORDING_FILE_EXTENSION = ".wav";
export const MEETING_AUDIO_SAMPLE_RATE = 48_000;

export const ELEVENLABS_REALTIME_MODEL_ID = "scribe_v2_realtime";
export const ELEVENLABS_BATCH_MODEL_ID = "scribe_v2";
export const ELEVENLABS_NUM_SPEAKERS: number | undefined = undefined;
export const ELEVENLABS_DIARIZATION_THRESHOLD: number | undefined = undefined;
