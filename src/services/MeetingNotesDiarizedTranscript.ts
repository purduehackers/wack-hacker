import {
    ELEVENLABS_BATCH_MODEL_ID,
    ELEVENLABS_DIARIZATION_THRESHOLD,
    ELEVENLABS_NUM_SPEAKERS,
} from "../constants";
import { MeetingTranscriptionError } from "../errors";

const ELEVENLABS_BATCH_TRANSCRIPT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

export interface SpeakerTranscriptSegment {
    readonly speakerId: string;
    readonly text: string;
}

export interface DiarizedTranscript {
    readonly transcriptionId: string | null;
    readonly text: string;
    readonly segments: ReadonlyArray<SpeakerTranscriptSegment>;
}

interface ElevenLabsWord {
    readonly text: string;
    readonly type?: string;
    readonly speaker_id?: string | null;
}

interface ElevenLabsBatchTranscriptResponse {
    readonly text: string;
    readonly words?: ReadonlyArray<ElevenLabsWord>;
    readonly transcription_id?: string;
}

interface MutableSpeakerSegment {
    speakerId: string;
    text: string;
}

function normalizeSpeakerId(speakerId: string | null | undefined): string {
    if (!speakerId || speakerId.trim().length === 0) {
        return "unknown";
    }

    return speakerId;
}

function buildSpeakerSegments(
    words: ReadonlyArray<ElevenLabsWord>,
): ReadonlyArray<SpeakerTranscriptSegment> {
    const segments: MutableSpeakerSegment[] = [];

    for (const word of words) {
        if (!word || typeof word.text !== "string" || word.text.length === 0) {
            continue;
        }

        const tokenText = word.text;
        const isSpacingToken = word.type === "spacing";
        const normalizedSpeakerId = normalizeSpeakerId(word.speaker_id);
        const lastSegment = segments.at(-1);

        if (isSpacingToken) {
            if (!lastSegment) {
                continue;
            }

            lastSegment.text += tokenText;
            continue;
        }

        if (lastSegment && lastSegment.speakerId === normalizedSpeakerId) {
            lastSegment.text += tokenText;
            continue;
        }

        segments.push({
            speakerId: normalizedSpeakerId,
            text: tokenText,
        });
    }

    return segments
        .map((segment): SpeakerTranscriptSegment => ({
            speakerId: segment.speakerId,
            text: segment.text.trim(),
        }))
        .filter((segment): boolean => segment.text.length > 0);
}

function buildBatchFormData(recordingPath: string): FormData {
    const formData = new FormData();

    formData.set("model_id", ELEVENLABS_BATCH_MODEL_ID);
    formData.set("diarize", "true");
    formData.set("timestamps_granularity", "word");

    if (ELEVENLABS_NUM_SPEAKERS !== undefined) {
        formData.set("num_speakers", String(ELEVENLABS_NUM_SPEAKERS));
    }

    if (ELEVENLABS_DIARIZATION_THRESHOLD !== undefined) {
        formData.set("diarization_threshold", String(ELEVENLABS_DIARIZATION_THRESHOLD));
    }

    formData.set("file", Bun.file(recordingPath));

    return formData;
}

export async function createDiarizedTranscript(
    elevenLabsApiKey: string,
    recordingPath: string,
): Promise<DiarizedTranscript> {
    const response = await fetch(ELEVENLABS_BATCH_TRANSCRIPT_URL, {
        method: "POST",
        headers: {
            "xi-api-key": elevenLabsApiKey,
        },
        body: buildBatchFormData(recordingPath),
    });

    const responseBody = await response.text();

    if (!response.ok) {
        throw new MeetingTranscriptionError({
            operation: "batchTranscribe",
            cause: new Error(`status=${response.status} body=${responseBody}`),
        });
    }

    const parsedJson = JSON.parse(responseBody) as ElevenLabsBatchTranscriptResponse;

    if (typeof parsedJson.text !== "string") {
        throw new MeetingTranscriptionError({
            operation: "batchTranscribe",
            cause: new Error("ElevenLabs batch transcription response missing text field"),
        });
    }

    const words = Array.isArray(parsedJson.words) ? parsedJson.words : [];
    const speakerSegments = buildSpeakerSegments(words);

    if (speakerSegments.length > 0) {
        return {
            transcriptionId:
                typeof parsedJson.transcription_id === "string" ? parsedJson.transcription_id : null,
            text: parsedJson.text,
            segments: speakerSegments,
        };
    }

    const normalizedText = parsedJson.text.trim();
    const fallbackSegments: ReadonlyArray<SpeakerTranscriptSegment> =
        normalizedText.length === 0
            ? []
            : [
                  {
                      speakerId: "unknown",
                      text: normalizedText,
                  } as const,
              ];

    return {
        transcriptionId: typeof parsedJson.transcription_id === "string" ? parsedJson.transcription_id : null,
        text: parsedJson.text,
        segments: fallbackSegments,
    };
}
