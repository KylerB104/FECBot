import {
  Client,
  EmbedBuilder,
} from "discord.js";
import type { AppConfig } from "../config.js";

export class AuditLog {
  constructor(
    private readonly client: Client,
    private readonly config: AppConfig,
  ) {}

  async send(
    title: string,
    description: string,
    fields: Array<{ name: string; value: string; inline?: boolean }> = [],
  ): Promise<boolean> {
    if (!this.config.logChannelId) return false;

    try {
      const channel = await this.client.channels.fetch(this.config.logChannelId);
      if (!channel?.isSendable()) return false;
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .addFields(fields)
            .setColor(0x234f9d)
            .setTimestamp(),
        ],
      });
      return true;
    } catch (error) {
      console.error("Could not send audit-channel message:", error);
      return false;
    }
  }
}
