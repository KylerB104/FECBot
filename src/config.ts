import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().default("1507913073481224294"),
  SUBMISSION_CHANNEL_ID: z.string().default("1509377579470028821"),
  CAMPAIGNER_ROLE_ID: z.string().default("1508134993078259864"),
  ADMIN_ROLE_IDS: z
    .string()
    .default("1507937813486637076,1507917036368695436"),
  SECRETARY_ROLE_ID: z.string().default("1507917036368695436"),
  OWNER_USER_IDS: z.string().default("750817725462478868"),
  LOG_CHANNEL_ID: z.string().optional().default(""),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  TIME_ZONE: z.string().default("America/New_York"),
  BOT_TONE: z.string().default("formal-casual"),
  GEOGRAPHY_FILE: z.string().optional().default(""),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  discordToken: string;
  discordClientId: string;
  guildId: string;
  submissionChannelId: string;
  campaignerRoleId: string;
  adminRoleIds: Set<string>;
  secretaryRoleId: string;
  ownerUserIds: Set<string>;
  logChannelId: string | null;
  databaseUrl: string;
  databaseSsl: boolean;
  timeZone: string;
  botTone: string;
  geographyFile: string | null;
}

function commaSeparatedSet(value: string): Set<string> {
  return new Set(
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const value = parsed.data;
  return {
    nodeEnv: value.NODE_ENV,
    discordToken: value.DISCORD_TOKEN,
    discordClientId: value.DISCORD_CLIENT_ID,
    guildId: value.DISCORD_GUILD_ID,
    submissionChannelId: value.SUBMISSION_CHANNEL_ID,
    campaignerRoleId: value.CAMPAIGNER_ROLE_ID,
    adminRoleIds: commaSeparatedSet(value.ADMIN_ROLE_IDS),
    secretaryRoleId: value.SECRETARY_ROLE_ID,
    ownerUserIds: commaSeparatedSet(value.OWNER_USER_IDS),
    logChannelId: value.LOG_CHANNEL_ID || null,
    databaseUrl: value.DATABASE_URL,
    databaseSsl: value.DATABASE_SSL,
    timeZone: value.TIME_ZONE,
    botTone: value.BOT_TONE,
    geographyFile: value.GEOGRAPHY_FILE || null,
  };
}
