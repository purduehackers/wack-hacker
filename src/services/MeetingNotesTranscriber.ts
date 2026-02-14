import { EndBehaviorType, type AudioReceiveStream, type VoiceConnection } from "@discordjs/voice";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import type { Snowflake } from "discord.js";
import { opus } from "prism-media";

import {
    ELEVENLABS_REALTIME_MODEL_ID,
    MEETING_AUDIO_SAMPLE_RATE,
    MEETING_RECORDING_FILE_EXTENSION,
    MEETING_RECORDINGS_DIRECTORY,
} from "../constants";
import { MeetingTranscriptionError } from "../errors";

export interface TranscriptUpdate {
    readonly text: string;
    readonly isCommitted: boolean;
}

const ELEVENLABS_TOKEN_URL = "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe";
const ELEVENLABS_REALTIME_URL = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

const FLUSH_INTERVAL_MS = 40;
const MIX_INTERVAL_MS = 20;
const AUDIO_CHANNEL_COUNT = 2;
const MONO_CHANNEL_COUNT = 1;
const PCM_FRAME_SIZE = 960;
const PCM_SAMPLE_BYTES = 2;
const PCM_FRAME_BYTES = PCM_FRAME_SIZE * MONO_CHANNEL_COUNT * PCM_SAMPLE_BYTES;
const SOCKET_STARTUP_TIMEOUT_MS = 10_000;
const SOCKET_CLOSE_TIMEOUT_MS = 2_000;
const AUDIO_FORMAT = "pcm_48000";
const COMMIT_STRATEGY = "vad";

const WAV_HEADER_SIZE_BYTES = 44;
const EMPTY_BUFFER = Buffer.alloc(0);

interface ActiveUserStream {
    readonly opusStream: AudioReceiveStream;
    readonly decoder: InstanceType<typeof opus.Decoder>;
}

interface UserAudioBuffer {
    readonly frames: Buffer[];
    partialFrame: Buffer;
    isActive: boolean;
}

interface InputAudioChunkMessage {
    readonly message_type: "input_audio_chunk";
    readonly audio_base_64: string;
    readonly sample_rate: number;
    readonly commit?: boolean;
}

interface RealtimeMessage {
    readonly message_type: string;
    readonly message?: string;
    readonly text?: string;
}

interface CreateMeetingSpeechTranscriberOptions {
    readonly connection: VoiceConnection;
    readonly elevenLabsApiKey: string;
    readonly onTranscript: (update: TranscriptUpdate) => Promise<void>;
}

function createOpusDecoder(): InstanceType<typeof opus.Decoder> {
    return new opus.Decoder({
        channels: AUDIO_CHANNEL_COUNT,
        frameSize: PCM_FRAME_SIZE,
        rate: MEETING_AUDIO_SAMPLE_RATE,
    });
}

function isSupportedRealtimeData(
    data: unknown,
): data is string | ArrayBuffer | ArrayBufferView<ArrayBufferLike> {
    return typeof data === "string" || data instanceof ArrayBuffer || ArrayBuffer.isView(data);
}

function toMessageString(data: unknown): string | null {
    if (!isSupportedRealtimeData(data)) {
        return null;
    }

    if (typeof data === "string") {
        return data;
    }

    if (data instanceof ArrayBuffer) {
        return Buffer.from(data).toString("utf8");
    }

    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
}

function parseRealtimeMessage(payload: string): RealtimeMessage | null {
    try {
        const parsedJson = JSON.parse(payload) as Record<string, unknown>;
        const messageType = parsedJson.message_type;

        if (typeof messageType !== "string") {
            return null;
        }

        return {
            message_type: messageType,
            message: typeof parsedJson.message === "string" ? parsedJson.message : undefined,
            text: typeof parsedJson.text === "string" ? parsedJson.text : undefined,
        };
    } catch {
        return null;
    }
}

function isRealtimeErrorType(messageType: string): boolean {
    return messageType.endsWith("error") || messageType === "error";
}

function buildRealtimeUrl(token: string): string {
    const queryParameters = new URLSearchParams({
        model_id: ELEVENLABS_REALTIME_MODEL_ID,
        token,
        audio_format: AUDIO_FORMAT,
        commit_strategy: COMMIT_STRATEGY,
    });

    return `${ELEVENLABS_REALTIME_URL}?${queryParameters.toString()}`;
}

function downmixStereoToMono(pcmChunk: Buffer): Buffer {
    const monoSampleCount = Math.floor(pcmChunk.length / 4);

    if (monoSampleCount === 0) {
        return Buffer.alloc(0);
    }

    const monoChunk = Buffer.allocUnsafe(monoSampleCount * 2);
    let writeOffset = 0;

    for (let readOffset = 0; readOffset + 3 < pcmChunk.length; readOffset += 4) {
        const leftSample = pcmChunk.readInt16LE(readOffset);
        const rightSample = pcmChunk.readInt16LE(readOffset + 2);
        const monoSample = Math.round((leftSample + rightSample) / 2);

        monoChunk.writeInt16LE(monoSample, writeOffset);
        writeOffset += 2;
    }

    return monoChunk;
}

function clampPcmSample(sample: number): number {
    if (sample > 32_767) {
        return 32_767;
    }

    if (sample < -32_768) {
        return -32_768;
    }

    return sample;
}

function mixPcmFrame(targetFrame: Buffer, sourceFrame: Buffer): void {
    for (let byteOffset = 0; byteOffset < PCM_FRAME_BYTES; byteOffset += 2) {
        const mixedSample = targetFrame.readInt16LE(byteOffset) + sourceFrame.readInt16LE(byteOffset);
        targetFrame.writeInt16LE(clampPcmSample(mixedSample), byteOffset);
    }
}

function createWavHeader(dataSizeBytes: number): Buffer {
    const header = Buffer.alloc(WAV_HEADER_SIZE_BYTES);
    const byteRate = MEETING_AUDIO_SAMPLE_RATE * MONO_CHANNEL_COUNT * 2;
    const blockAlign = MONO_CHANNEL_COUNT * 2;
    const riffChunkSize = 36 + dataSizeBytes;

    header.write("RIFF", 0);
    header.writeUInt32LE(riffChunkSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(MONO_CHANNEL_COUNT, 22);
    header.writeUInt32LE(MEETING_AUDIO_SAMPLE_RATE, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSizeBytes, 40);

    return header;
}

function buildRecordingPath(guildId: string): string {
    const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    return join(MEETING_RECORDINGS_DIRECTORY, `${guildId}-${timestamp}${MEETING_RECORDING_FILE_EXTENSION}`);
}

export class MeetingSpeechTranscriber {
    readonly #connection: VoiceConnection;
    readonly #elevenLabsApiKey: string;
    readonly #onTranscript: (update: TranscriptUpdate) => Promise<void>;
    readonly #activeUserStreams = new Map<Snowflake, ActiveUserStream>();
    readonly #userAudioBuffers = new Map<Snowflake, UserAudioBuffer>();
    readonly #pendingMonoChunks: Buffer[] = [];
    readonly #onSpeakerStart: (userId: string) => void;
    readonly #recordingPath: string;
    readonly #recordingStream: WriteStream;

    #recordedPcmBytes = 0;
    #socket: WebSocket | null = null;
    #mixInterval: NodeJS.Timeout | null = null;
    #flushInterval: NodeJS.Timeout | null = null;
    #stopPromise: Promise<string> | null = null;
    #stopped = false;

    private constructor(options: CreateMeetingSpeechTranscriberOptions) {
        this.verifyOpusBackend();
        this.#connection = options.connection;
        this.#elevenLabsApiKey = options.elevenLabsApiKey;
        this.#onTranscript = options.onTranscript;

        mkdirSync(MEETING_RECORDINGS_DIRECTORY, { recursive: true });

        this.#recordingPath = buildRecordingPath(options.connection.joinConfig.guildId ?? "unknown-guild");
        this.#recordingStream = createWriteStream(this.#recordingPath);
        this.#recordingStream.write(createWavHeader(0));

        this.#onSpeakerStart = (userId): void => {
            this.subscribeToUser(userId);
        };
    }

    public static async create(options: CreateMeetingSpeechTranscriberOptions): Promise<MeetingSpeechTranscriber> {
        const transcriber = new MeetingSpeechTranscriber(options);

        try {
            await transcriber.connectRealtimeSocket();
            transcriber.startVoiceCapture();
            return transcriber;
        } catch (cause) {
            await transcriber.stop();
            throw new MeetingTranscriptionError({ operation: "create", cause });
        }
    }

    public get recordingPath(): string {
        return this.#recordingPath;
    }

    public subscribeUser(userId: Snowflake): void {
        this.subscribeToUser(userId);
    }

    public async stop(): Promise<string> {
        if (this.#stopPromise) {
            return this.#stopPromise;
        }

        this.#stopPromise = this.stopInternal();

        return this.#stopPromise;
    }

    private async connectRealtimeSocket(): Promise<void> {
        const token = await this.fetchRealtimeToken();
        const socket = new WebSocket(buildRealtimeUrl(token));

        await this.waitForSessionStarted(socket);

        socket.addEventListener("message", (event: MessageEvent): void => {
            this.handleRealtimeMessage(event.data);
        });

        this.#socket = socket;
    }

    private async fetchRealtimeToken(): Promise<string> {
        const response = await fetch(ELEVENLABS_TOKEN_URL, {
            method: "POST",
            headers: {
                "xi-api-key": this.#elevenLabsApiKey,
            },
        });

        const responseBody = await response.text();

        if (!response.ok) {
            throw new MeetingTranscriptionError({
                operation: "fetchRealtimeToken",
                cause: new Error(`token request failed status=${response.status} body=${responseBody}`),
            });
        }

        const parsedJson = JSON.parse(responseBody) as Record<string, unknown>;

        if (typeof parsedJson.token !== "string" || parsedJson.token.length === 0) {
            throw new MeetingTranscriptionError({
                operation: "fetchRealtimeToken",
                cause: new Error("ElevenLabs token endpoint returned no token"),
            });
        }

        return parsedJson.token;
    }

    private waitForSessionStarted(socket: WebSocket): Promise<void> {
        return new Promise<void>((resolve, reject): void => {
            const startupTimeout = setTimeout((): void => {
                cleanup();
                try {
                    socket.close();
                } finally {
                    reject(
                        new MeetingTranscriptionError({
                            operation: "waitForSessionStarted",
                            cause: new Error("timed out waiting for ElevenLabs realtime session startup"),
                        }),
                    );
                }
            }, SOCKET_STARTUP_TIMEOUT_MS);

            const cleanup = (): void => {
                clearTimeout(startupTimeout);
                socket.removeEventListener("message", onMessage);
                socket.removeEventListener("error", onError);
                socket.removeEventListener("close", onClose);
            };

            const fail = (reason: string): void => {
                cleanup();
                try {
                    socket.close();
                } finally {
                    reject(
                        new MeetingTranscriptionError({
                            operation: "waitForSessionStarted",
                            cause: new Error(reason),
                        }),
                    );
                }
            };

            const onMessage = (event: MessageEvent): void => {
                const messagePayload = toMessageString(event.data);

                if (!messagePayload) {
                    return;
                }

                const realtimeMessage = parseRealtimeMessage(messagePayload);

                if (!realtimeMessage) {
                    return;
                }

                if (realtimeMessage.message_type === "session_started") {
                    cleanup();
                    resolve();
                    return;
                }

                if (isRealtimeErrorType(realtimeMessage.message_type)) {
                    fail(realtimeMessage.message ?? "ElevenLabs rejected realtime session startup");
                }
            };

            const onError = (): void => {
                fail("ElevenLabs realtime websocket error during startup");
            };

            const onClose = (): void => {
                fail("ElevenLabs realtime websocket closed before startup completed");
            };

            socket.addEventListener("message", onMessage);
            socket.addEventListener("error", onError);
            socket.addEventListener("close", onClose);
        });
    }

    private startVoiceCapture(): void {
        this.#connection.receiver.speaking.on("start", this.#onSpeakerStart);

        this.#mixInterval = setInterval((): void => {
            this.mixAndQueueFrame();
        }, MIX_INTERVAL_MS);

        this.#flushInterval = setInterval((): void => {
            this.flushQueuedAudio(false);
        }, FLUSH_INTERVAL_MS);

        this.#mixInterval.unref();
        this.#flushInterval.unref();
    }

    private handleRealtimeMessage(data: unknown): void {
        const messagePayload = toMessageString(data);

        if (!messagePayload) {
            return;
        }

        const realtimeMessage = parseRealtimeMessage(messagePayload);

        if (!realtimeMessage || !realtimeMessage.text) {
            return;
        }

        const isCommittedTranscript =
            realtimeMessage.message_type === "committed_transcript" ||
            realtimeMessage.message_type === "committed_transcript_with_timestamps";
        const isPartialTranscript = realtimeMessage.message_type === "partial_transcript";

        if (!isCommittedTranscript && !isPartialTranscript) {
            return;
        }

        void this.#onTranscript({
            text: realtimeMessage.text,
            isCommitted: isCommittedTranscript,
        });
    }

    private subscribeToUser(userId: Snowflake): void {
        if (this.#stopped || this.#activeUserStreams.has(userId)) {
            return;
        }

        const opusStream = this.#connection.receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.Manual,
            },
        });
        const decoder = createOpusDecoder();
        const cleanup = (): void => {
            this.cleanupUserStream(userId);
        };
        const userAudioBuffer = this.#userAudioBuffers.get(userId) ?? {
            frames: [],
            partialFrame: EMPTY_BUFFER,
            isActive: true,
        };

        userAudioBuffer.isActive = true;

        this.#userAudioBuffers.set(userId, userAudioBuffer);

        this.#activeUserStreams.set(userId, {
            opusStream,
            decoder,
        });

        opusStream.pipe(decoder);

        decoder.on("data", (chunk: Buffer): void => {
            this.queueUserAudio(userId, chunk);
        });

        opusStream.once("end", cleanup);
        opusStream.once("close", cleanup);
        opusStream.once("error", cleanup);
        decoder.once("close", cleanup);
        decoder.once("error", cleanup);
    }

    private queueUserAudio(userId: Snowflake, chunk: Buffer): void {
        if (this.#stopped) {
            return;
        }

        const userAudioBuffer = this.#userAudioBuffers.get(userId);

        if (!userAudioBuffer) {
            return;
        }

        const monoChunk = downmixStereoToMono(chunk);

        if (monoChunk.length === 0) {
            return;
        }

        let pending =
            userAudioBuffer.partialFrame.length === 0
                ? monoChunk
                : Buffer.concat([userAudioBuffer.partialFrame, monoChunk]);

        while (pending.length >= PCM_FRAME_BYTES) {
            userAudioBuffer.frames.push(pending.subarray(0, PCM_FRAME_BYTES));
            pending = pending.subarray(PCM_FRAME_BYTES);
        }

        userAudioBuffer.partialFrame = Buffer.from(pending);
    }

    private mixAndQueueFrame(): void {
        if (this.#stopped) {
            return;
        }

        const mixedFrame = Buffer.alloc(PCM_FRAME_BYTES);
        let hasAudio = false;

        for (const [userId, userAudioBuffer] of this.#userAudioBuffers) {
            const frame = userAudioBuffer.frames.shift();

            if (frame) {
                hasAudio = true;
                mixPcmFrame(mixedFrame, frame);
            }

            if (
                !userAudioBuffer.isActive &&
                userAudioBuffer.frames.length === 0 &&
                userAudioBuffer.partialFrame.length === 0
            ) {
                this.#userAudioBuffers.delete(userId);
            }
        }

        if (!hasAudio) {
            return;
        }

        this.#pendingMonoChunks.push(mixedFrame);
        this.#recordedPcmBytes += mixedFrame.length;
        this.#recordingStream.write(mixedFrame);
    }

    private flushQueuedAudio(commit: boolean): void {
        if (this.#pendingMonoChunks.length === 0) {
            return;
        }

        const socket = this.#socket;

        if (!socket || socket.readyState !== WebSocket.OPEN) {
            return;
        }

        const audioChunk = Buffer.concat(this.#pendingMonoChunks);
        this.#pendingMonoChunks.length = 0;

        const realtimeMessage = {
            message_type: "input_audio_chunk",
            audio_base_64: audioChunk.toString("base64"),
            sample_rate: MEETING_AUDIO_SAMPLE_RATE,
            commit,
        } satisfies InputAudioChunkMessage;

        socket.send(JSON.stringify(realtimeMessage));
    }

    private cleanupUserStream(userId: Snowflake): void {
        const userAudioBuffer = this.#userAudioBuffers.get(userId);

        if (userAudioBuffer) {
            if (userAudioBuffer.partialFrame.length > 0) {
                const finalFrame = Buffer.alloc(PCM_FRAME_BYTES);
                userAudioBuffer.partialFrame.copy(finalFrame);
                userAudioBuffer.frames.push(finalFrame);
                userAudioBuffer.partialFrame = EMPTY_BUFFER;
            }

            userAudioBuffer.isActive = false;
        }

        const activeStream = this.#activeUserStreams.get(userId);

        if (!activeStream) {
            return;
        }

        this.#activeUserStreams.delete(userId);
        activeStream.opusStream.destroy();
        activeStream.decoder.destroy();
    }

    private async stopInternal(): Promise<string> {
        this.#stopped = true;

        if (this.#mixInterval) {
            clearInterval(this.#mixInterval);
            this.#mixInterval = null;
        }

        if (this.#flushInterval) {
            clearInterval(this.#flushInterval);
            this.#flushInterval = null;
        }

        this.#connection.receiver.speaking.off("start", this.#onSpeakerStart);

        for (const userId of this.#activeUserStreams.keys()) {
            this.cleanupUserStream(userId);
        }

        this.flushBufferedAudio();
        this.flushQueuedAudio(true);
        this.#pendingMonoChunks.length = 0;

        await this.closeSocket();
        await this.finalizeRecording();

        return this.#recordingPath;
    }

    private flushBufferedAudio(): void {
        while (true) {
            const mixedFrame = Buffer.alloc(PCM_FRAME_BYTES);
            let hasAudio = false;

            for (const [userId, userAudioBuffer] of this.#userAudioBuffers) {
                if (userAudioBuffer.partialFrame.length > 0) {
                    const finalFrame = Buffer.alloc(PCM_FRAME_BYTES);
                    userAudioBuffer.partialFrame.copy(finalFrame);
                    userAudioBuffer.frames.push(finalFrame);
                    userAudioBuffer.partialFrame = EMPTY_BUFFER;
                }

                const frame = userAudioBuffer.frames.shift();

                if (frame) {
                    hasAudio = true;
                    mixPcmFrame(mixedFrame, frame);
                }

                if (
                    !userAudioBuffer.isActive &&
                    userAudioBuffer.frames.length === 0 &&
                    userAudioBuffer.partialFrame.length === 0
                ) {
                    this.#userAudioBuffers.delete(userId);
                }
            }

            if (!hasAudio) {
                break;
            }

            this.#pendingMonoChunks.push(mixedFrame);
            this.#recordedPcmBytes += mixedFrame.length;
            this.#recordingStream.write(mixedFrame);
        }
    }

    private async closeSocket(): Promise<void> {
        const socket = this.#socket;

        if (!socket) {
            return;
        }

        this.#socket = null;

        if (socket.readyState === WebSocket.CLOSED) {
            return;
        }

        await new Promise<void>((resolve): void => {
            const closeTimeout = setTimeout(resolve, SOCKET_CLOSE_TIMEOUT_MS);

            socket.addEventListener(
                "close",
                (): void => {
                    clearTimeout(closeTimeout);
                    resolve();
                },
                { once: true },
            );

            socket.close();
        });
    }

    private async finalizeRecording(): Promise<void> {
        await new Promise<void>((resolve, reject): void => {
            this.#recordingStream.once("error", reject);
            this.#recordingStream.end((): void => {
                resolve();
            });
        });

        const fileHandle = await open(this.#recordingPath, "r+");

        try {
            await fileHandle.write(createWavHeader(this.#recordedPcmBytes), 0, WAV_HEADER_SIZE_BYTES, 0);
        } finally {
            await fileHandle.close();
        }
    }

    private verifyOpusBackend(): void {
        try {
            const decoder = createOpusDecoder();
            decoder.destroy();
        } catch (cause) {
            throw new MeetingTranscriptionError({ operation: "verifyOpusBackend", cause });
        }
    }
}
