export interface ScriptContext {
    botToken: string;
    guildId: string;
    channelId: string;
    messageId: string;
    authorId: string;
}

export const buildExecutableScript = (mainFunctionBody: string, context: ScriptContext): string => `
import { 
  Client, 
  Events,
  GatewayIntentBits, 
  Partials, 
  ChannelType,
  Collection,
  Role,
  GuildMember,
  User,
  Message,
  TextChannel,
  Guild,
  PermissionFlagsBits,
} from "discord.js";

const logs: string[] = [];
const errors: string[] = [];

const log = (...args: any[]): void => {
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  const formatted = args.map(arg => {
    if (arg === null) return "null";
    if (arg === undefined) return "undefined";
    if (typeof arg === "object") {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(" ");
  
  logs.push(\`[\${timestamp}] \${formatted}\`);
};

const logError = (...args: any[]): void => {
  const timestamp = new Date().toISOString().split("T")[1].split(".")[0];
  const formatted = args.map(arg => {
    if (arg === null) return "null";
    if (arg === undefined) return "undefined";
    if (typeof arg === "object") {
      try {
        return JSON.stringify(arg, null, 2);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  }).join(" ");
  
  errors.push(\`[\${timestamp}] \${formatted}\`);
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [
    Partials.GuildMember,
    Partials.Message,
    Partials.User,
  ],
});

async function main(): Promise<void> {
  const guild: Guild = await client.guilds.fetch("${context.guildId}");
  const channel = await guild.channels.fetch("${context.channelId}") as TextChannel;
  const message: Message = await channel.messages.fetch("${context.messageId}");
  const author: User = await client.users.fetch("${context.authorId}");

  log("Code execution started");
  log(\`Guild: \${guild.name} (\${guild.id})\`);
  log(\`Channel: #\${channel.name}\`);
  log(\`Triggered by: \${author.tag}\`);
  log("---");

${mainFunctionBody
    .split("\n")
    .map((line) => "  " + line)
    .join("\n")}
}

client.once(Events.ClientReady, async () => {
  const startTime = Date.now();
  
  try {
    await main();
    
    self.postMessage({
      type: "success",
      logs,
      errors,
      duration_ms: Date.now() - startTime,
    });
  } catch (error: any) {
    logError(error?.message || String(error));
    if (error?.stack) {
      logError(error.stack);
    }
    
    self.postMessage({
      type: "error",
      error: error?.message || String(error),
      stack: error?.stack,
      logs,
      errors,
      duration_ms: Date.now() - startTime,
    });
  } finally {
    try {
      await client.destroy();
    } catch {
      // Ignore cleanup errors
    }
  }
});

client.login("${context.botToken}");
`;
