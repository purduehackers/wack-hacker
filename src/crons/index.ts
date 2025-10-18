import hackNightPhotosCleanup from "./hack-night-photo-cleanup";
import hackNightPhotos from "./hack-night-photos";
import hackNightAttendanceInit from "./attendance-creation";
import hackNightAttendanceReminderFriday from "./attendance-reminder-friday";
import hackNightAttendanceReminderSaturday from "./attendance-reminder-saturday";

export const tasks = [
    hackNightPhotos,
    hackNightPhotosCleanup,
    hackNightAttendanceInit,
    hackNightAttendanceReminderFriday,
    hackNightAttendanceReminderSaturday,
];
